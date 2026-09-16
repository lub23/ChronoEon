import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
import { BackgroundTimingError, configureBackground, syncBackgroundTimer, backgroundTimerSnapshot, acknowledgeBackgroundReminders } from "./background";
beforeEach(() => native.invoke.mockReset());
describe("native background boundary", () => {
  it("serializes configuration, timer changes and reads", async () => {
    let finish!: (value: unknown) => void;
    native.invoke.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({});
    const first = configureBackground("zh", true); const second = syncBackgroundTimer(); const third = backgroundTimerSnapshot();
    await Promise.resolve(); expect(native.invoke).toHaveBeenCalledTimes(1);
    finish({}); await Promise.all([first, second, third]);
    expect(native.invoke.mock.calls.map(([, args]) => args.action)).toEqual(["sync", "timerSync", "timerSnapshot"]);
    expect(native.invoke.mock.calls[0]).toEqual(["background_command", { action: "sync", language: "zh", remindersEnabled: true }]);
  });
  it("recovers the queue after failures without silently claiming success", async () => {
    native.invoke.mockRejectedValueOnce(new Error("denied")).mockResolvedValue({});
    await expect(syncBackgroundTimer()).rejects.toBeInstanceOf(BackgroundTimingError);
    await acknowledgeBackgroundReminders(["entry:date:epoch"]);
    expect(native.invoke).toHaveBeenLastCalledWith("background_command", { action: "ackReminders", keys: ["entry:date:epoch"] });
  });
});
