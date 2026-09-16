// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimerSession, type TimerSession } from "@chronoeon/domain";
import type { TimerStore } from "@chronoeon/storage";
const native = vi.hoisted(() => ({ snapshot: vi.fn(), sync: vi.fn() }));
vi.mock("../platform/desktop", () => ({ isTauri: () => true }));
vi.mock("../platform/background", () => ({ backgroundTimingSupported: () => true, backgroundTimerSnapshot: native.snapshot, syncBackgroundTimer: native.sync }));
import { useLiveTimer, type LiveTimer } from "./useLiveTimer";
let host: HTMLDivElement, root: Root, live: LiveTimer, stored: TimerSession | null;
const save = vi.fn(), load = vi.fn(), onError = vi.fn();
const store = { load, save } as unknown as TimerStore;
function Harness() { live = useLiveTimer(store, vi.fn(), undefined, onError); return null; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 12, 9));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  stored = null; save.mockReset().mockImplementation(async value => { stored = value; }); load.mockReset(); onError.mockReset();
  native.sync.mockReset().mockResolvedValue({}); native.snapshot.mockReset().mockImplementation(async () => ({ session: stored ? { ...stored, lastTick: Date.now() } : null }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); Object.defineProperty(document, "hidden", { configurable: true, value: false }); });
async function start() { await act(async () => { root.render(<Harness />); }); await act(async () => { live.start({ title: "Read", calendarId: "default" }); }); }
async function visibility(hidden: boolean) { Object.defineProperty(document, "hidden", { configurable: true, value: hidden }); await act(async () => document.dispatchEvent(new Event("visibilitychange"))); }
describe("Android timer ownership", () => {
  it("persists transitions before syncing the service, without five-second WebView heartbeats", async () => {
    await start(); expect(save).toHaveBeenCalledTimes(1); expect(native.sync).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(live.elapsed).toBe(60_000); expect(save).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    await act(async () => live.pause()); expect(stored?.segments.at(-1)?.end).toBe(Date.now()); expect(native.sync).toHaveBeenCalledTimes(3);
  });
  it("stops hidden page ticks and restores a service-backed recording after deep sleep", async () => {
    await start(); await visibility(true);
    await act(async () => vi.advanceTimersByTimeAsync(180_000));
    expect(live.elapsed).toBe(0); expect(save).toHaveBeenCalledTimes(1);
    await visibility(false);
    expect(live.elapsed).toBe(180_000); expect(live.running).toBe(true); expect(live.recovered).toBe(false);
  });
  it("does not invent elapsed time when the native service was interrupted", async () => {
    const started = Date.now() - 600_000;
    stored = { ...createTimerSession({ title: "Interrupted", calendarId: "default" }, started), lastTick: started + 60_000 };
    native.snapshot.mockImplementation(async () => ({ session: stored }));
    await act(async () => root.render(<Harness />));
    expect(live.running).toBe(false); expect(live.recovered).toBe(true); expect(live.elapsed).toBe(60_000);
    expect(stored?.segments.at(-1)?.end).toBe(started + 60_000);
  });
  it("clears the authoritative row before cancelling the service", async () => {
    await start(); await act(async () => live.cancel());
    expect(stored).toBeNull(); expect(save).toHaveBeenLastCalledWith(null); expect(live.active).toBe(false);
    expect(native.sync).toHaveBeenCalledTimes(3);
  });
});
