import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineResult, SyncLocalStatus } from "@chronoeon/storage";
import { REMOTE_POLL_MS, SyncScheduler } from "./scheduler";
const success: EngineResult = {ok:true,sent:0,received:0,conflicts:0,snapshotCreated:false,attachmentCount:0};
function fixture(online = true) {
  let changed = () => {};
  let status: SyncLocalStatus = {lastSnapshotAt:null,nextSnapshotAt:null,pending:0,conflicts:0,failures:0,nextAttempt:0,lastSuccess:null,lastError:null,missingAttachments:0};
  const engine = { run: vi.fn(async () => success) };
  const store = { subscribe: vi.fn((listener:()=>void) => { changed=listener; return vi.fn(); }), flush:vi.fn(async()=>{}), status:vi.fn(async()=>status) };
  const report = vi.fn(); const scheduler = new SyncScheduler(engine,store,report,()=>online);
  return {scheduler,engine,store,report,change:()=>changed(),setStatus:(next:Partial<SyncLocalStatus>)=>{status={...status,...next};},setOnline:(next:boolean)=>{online=next;}};
}
afterEach(()=>vi.useRealTimers());
describe("automatic sync scheduling",()=>{
  it("syncs on startup, then waits 60 quiet seconds after the last edit",async()=>{
    vi.useFakeTimers(); const f=fixture(); f.scheduler.start(); await vi.advanceTimersByTimeAsync(0);
    expect(f.engine.run).toHaveBeenCalledTimes(1);
    f.change(); await vi.advanceTimersByTimeAsync(30000); f.change();
    await vi.advanceTimersByTimeAsync(59999); expect(f.engine.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(f.engine.run).toHaveBeenCalledTimes(2); f.scheduler.dispose();
  });
  it("flushes local operations offline, then syncs on an online/background/manual trigger",async()=>{
    vi.useFakeTimers(); const f=fixture(false); f.scheduler.start(); await vi.advanceTimersByTimeAsync(0);
    expect(f.store.flush).toHaveBeenCalled(); expect(f.engine.run).not.toHaveBeenCalled();
    f.setOnline(true); await f.scheduler.trigger(); expect(f.engine.run).toHaveBeenCalledTimes(1); f.scheduler.dispose();
  });
  it("restores durable backoff across restarts without dropping the queued work",async()=>{
    vi.useFakeTimers(); const f=fixture(); f.setStatus({failures:1,nextAttempt:Date.now()+5000}); f.scheduler.start();
    await vi.advanceTimersByTimeAsync(4999); expect(f.engine.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.engine.run).toHaveBeenCalledTimes(1); f.scheduler.dispose();
  });
  it("does not let a new local edit cancel a scheduled retry",async()=>{
    vi.useFakeTimers(); const f=fixture(); f.engine.run.mockImplementationOnce(async()=>{f.setStatus({failures:1,nextAttempt:Date.now()+5000});throw new Error("offline");});
    f.scheduler.start(); await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(2500); f.change();
    await vi.advanceTimersByTimeAsync(2500); expect(f.engine.run).toHaveBeenCalledTimes(2); f.scheduler.dispose();
  });
  it("coalesces simultaneous triggers and catches failures while flushing",async()=>{
    vi.useFakeTimers(); const f=fixture(); let finish!:(result:EngineResult)=>void;
    f.engine.run.mockImplementationOnce(()=>new Promise((resolve)=>{finish=resolve;}));
    const one=f.scheduler.trigger(); await vi.advanceTimersByTimeAsync(0); const two=f.scheduler.trigger();
    expect(one).toBe(two); finish(success); await one; expect(f.engine.run).toHaveBeenCalledTimes(1);
    f.store.flush.mockRejectedValueOnce(new Error("busy")); await expect(f.scheduler.trigger()).resolves.toBeUndefined();
    expect(f.report).toHaveBeenLastCalledWith(expect.any(Error),false); f.scheduler.dispose();
  });
  it("removes all wakeups on disposal",async()=>{
    vi.useFakeTimers(); const f=fixture(); f.scheduler.start(); await vi.advanceTimersByTimeAsync(0); f.change();
    f.scheduler.dispose(); await vi.advanceTimersByTimeAsync(120000); expect(f.engine.run).toHaveBeenCalledTimes(1);
  });
});


describe("seven-day snapshot wake-ups", () => {
  const week = 7 * 24 * 60 * 60_000;
  it("wakes at the snapshot deadline even without edits", async () => {
    vi.useFakeTimers(); const f = fixture();
    f.setStatus({ nextSnapshotAt: new Date(Date.now() + week).toISOString() });
    f.scheduler.start(); await vi.advanceTimersByTimeAsync(0);
    const polls = Math.floor((week - 1) / REMOTE_POLL_MS);
    await vi.advanceTimersByTimeAsync(week - 1); expect(f.engine.run).toHaveBeenCalledTimes(1 + polls);
    await vi.advanceTimersByTimeAsync(1); expect(f.engine.run).toHaveBeenCalledTimes(2 + polls);
    f.scheduler.dispose();
  });
  it("polls the remote index each minute so online peers receive changes",async()=>{
    vi.useFakeTimers(); const f=fixture(); f.scheduler.start(); await vi.advanceTimersByTimeAsync(0);
    expect(f.engine.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REMOTE_POLL_MS - 1); expect(f.engine.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(f.engine.run).toHaveBeenCalledTimes(2);
    f.scheduler.dispose();
  });
  it("does not wake peer polling while offline or inside durable backoff",async()=>{
    vi.useFakeTimers(); const f=fixture(false); f.scheduler.start();
    await vi.advanceTimersByTimeAsync(REMOTE_POLL_MS); expect(f.engine.run).not.toHaveBeenCalled();
    f.scheduler.dispose();

    const retrying=fixture(); retrying.setStatus({failures:1,nextAttempt:Date.now()+REMOTE_POLL_MS*2});
    retrying.scheduler.start(); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(REMOTE_POLL_MS);
    expect(retrying.engine.run).not.toHaveBeenCalled();
    retrying.scheduler.dispose();
  });
  it("queues a manual rebuild behind an active automatic run instead of dropping it", async () => {
    vi.useFakeTimers(); const f = fixture(); let finish!: (value: EngineResult) => void;
    f.engine.run.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const running = f.scheduler.trigger(); await vi.advanceTimersByTimeAsync(0);
    const rebuild = f.scheduler.trigger({ rebuildSnapshot: true });
    expect(f.scheduler.trigger({ rebuildSnapshot: true })).toBe(rebuild);
    finish(success); await running; await rebuild;
    expect(f.engine.run).toHaveBeenCalledTimes(2); expect(f.engine.run).toHaveBeenLastCalledWith({ rebuildSnapshot: true });
    f.scheduler.dispose();
  });
  it("cancels the independent deadline timer when disposed", async () => {
    vi.useFakeTimers(); const f = fixture(); f.setStatus({ nextSnapshotAt: new Date(Date.now() + week).toISOString() });
    f.scheduler.start(); await vi.advanceTimersByTimeAsync(0); f.scheduler.dispose();
    await vi.advanceTimersByTimeAsync(week + 1); expect(f.engine.run).toHaveBeenCalledTimes(1);
  });
});
