// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimerStore } from "@chronoeon/storage";
import { useLiveTimer, type LiveTimer } from "./useLiveTimer";

const platform = vi.hoisted(() => ({ native: false }));
vi.mock("../platform/desktop", () => ({ isTauri: () => platform.native, isAndroidTauri: () => false }));
let host: HTMLDivElement, root: Root, live: LiveTimer;
const store = { load: vi.fn(), save: vi.fn() };
const onFinish = vi.fn(), onEvent = vi.fn(), onError = vi.fn();
function Harness({ nativeStore = true }: { nativeStore?: boolean }) {
  live = useLiveTimer(nativeStore ? store as unknown as TimerStore : null, onFinish, onEvent, onError);
  return null;
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 9, 9));
  platform.native = false; window.localStorage.clear();
  store.load.mockReset().mockResolvedValue(null); store.save.mockReset().mockResolvedValue(undefined);
  onFinish.mockReset().mockResolvedValue(undefined); onEvent.mockReset(); onError.mockReset();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
async function start() {
  await act(async () => { root.render(<Harness />); });
  await act(async () => { live.start({ title: "Read", calendarId: "default", category: "学习" }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
}

describe("live timer durability", () => {
  it("retains a paused recording on failure and can retry without counting retry time", async () => {
    await start(); onFinish.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => { await expect(live.stop()).rejects.toThrow("disk full"); });
    expect(live.active).toBe(true); expect(live.running).toBe(false); expect(live.elapsed).toBe(5000);
    expect(store.save).not.toHaveBeenCalledWith(null);
    expect(onEvent.mock.calls.map(([event]) => event)).not.toContain("stop");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); await live.stop(); });
    expect(live.active).toBe(false);
    expect(onFinish.mock.calls[1][0][0].end - onFinish.mock.calls[1][0][0].start).toBe(5000);
    expect(store.save).toHaveBeenLastCalledWith(null);
  });

  it("serializes duplicate stop commands and incorporates details edited in the same tick", async () => {
    await start();
    let finish!: () => void;
    onFinish.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { live.update({ note: "chapter 3", images: ["att:photo"] }); first = live.stop(); second = live.stop(); });
    expect(first).toBe(second); expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0][1]).toMatchObject({ note: "chapter 3", images: ["att:photo"] });
    expect(live.finishing).toBe(true);
    await act(async () => { finish(); await first; });
    expect(live.finishing).toBe(false); expect(live.active).toBe(false);
  });

  it("does not duplicate an entry if clearing the timer row must be retried", async () => {
    await start(); let failClear = true;
    store.save.mockImplementation(async (session) => { if (!session && failClear) { failClear = false; throw new Error("clear failed"); } });
    await act(async () => { await expect(live.stop()).rejects.toThrow("clear failed"); });
    expect(live.active).toBe(true);
    await act(async () => { await live.stop(); });
    expect(onFinish).toHaveBeenCalledTimes(1); expect(live.active).toBe(false);
  });

  it("does not replace an existing session on a second start in the same render", async () => {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { live.start({ title: "first", calendarId: "default" }); live.start({ title: "second", calendarId: "default" }); });
    expect(live.session?.title).toBe("first"); expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("waits for the native store rather than loading the browser demo timer", async () => {
    platform.native = true;
    window.localStorage.setItem("chronoeon.timer.active", JSON.stringify({ title: "demo", segments: [] }));
    await act(async () => { root.render(<Harness nativeStore={false} />); });
    expect(live.ready).toBe(false); expect(live.session).toBeNull();
    await act(async () => { root.render(<Harness />); });
    expect(live.ready).toBe(true); expect(live.session).toBeNull();
  });
});
