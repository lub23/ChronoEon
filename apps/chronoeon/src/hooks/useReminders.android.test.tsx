// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dueReminders, type Entry } from "@chronoeon/domain";
const native = vi.hoisted(() => ({ configure: vi.fn(), consume: vi.fn(), ack: vi.fn(), show: vi.fn() }));
vi.mock("../platform/background", () => ({ backgroundTimingSupported: () => true, configureBackground: native.configure, consumeBackgroundReminders: native.consume, acknowledgeBackgroundReminders: native.ack }));
vi.mock("../platform/notifications", () => ({ notificationPermission: async () => "granted", requestNotificationPermission: async () => "granted", showSystemNotification: native.show }));
import { useReminders } from "./useReminders";
let host: HTMLDivElement, root: Root;
const remind = vi.fn(), error = vi.fn();
const entry: Entry = { id: "e", title: "Meeting", date: "2026-09-12", start: "09:00", kind: "event", category: "work", color: "#333333", createdAt: "2026-09-12T00:00:00Z", reminder: "at-time" };
const entries = [entry];
function Harness({ enabled = true }: { enabled?: boolean }) { useReminders({ entries, locale: "zh", enabled, onRemind: remind, onError: error }); return null; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 12, 9, 0, 1));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  vi.clearAllMocks(); native.configure.mockResolvedValue({}); native.consume.mockResolvedValue({ keys: [dueReminders(entries)[0].key] }); native.ack.mockResolvedValue({});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); Object.defineProperty(document, "hidden", { configurable: true, value: false }); });
describe("native reminder handoff", () => {
  it("shows native receipts once in the foreground, without duplicate OS notifications", async () => {
    await act(async () => root.render(<Harness />));
    expect(native.configure).toHaveBeenCalledWith("zh", true); expect(remind).toHaveBeenCalledTimes(1);
    expect(native.show).not.toHaveBeenCalled(); expect(native.ack).toHaveBeenCalledWith([dueReminders(entries)[0].key]);
    await act(async () => vi.advanceTimersByTimeAsync(30_000)); expect(remind).toHaveBeenCalledTimes(1);
  });
  it("leaves receipts unacknowledged if the screen hides while a read is in flight", async () => {
    let resolve!: (value: { keys: string[] }) => void;
    native.consume.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await act(async () => root.render(<Harness />));
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); resolve({ keys: [dueReminders(entries)[0].key] }); });
    expect(remind).not.toHaveBeenCalled(); expect(native.ack).not.toHaveBeenCalled();
    const calls = native.consume.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(native.consume).toHaveBeenCalledTimes(calls);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(remind).toHaveBeenCalledTimes(1); expect(native.ack).toHaveBeenCalledTimes(1);
  });
  it("cancels OS schedules when reminders are disabled", async () => {
    await act(async () => root.render(<Harness enabled={false} />));
    expect(native.configure).toHaveBeenCalledWith("zh", false); expect(native.consume).not.toHaveBeenCalled(); expect(remind).not.toHaveBeenCalled();
  });
});
