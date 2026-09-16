import { describe, expect, it } from "vitest";
import { closeTimerWindow, emitTimerState, listenTimerCommands, listenTimerState, openTimerWindow, sendTimerCommand } from "./timerWindow";

describe("timerWindow outside Tauri", () => {
  it("is a no-op for every bridge call", async () => {
    await expect(openTimerWindow()).resolves.toBeUndefined();
    await expect(closeTimerWindow()).resolves.toBeUndefined();
    await expect(emitTimerState(null)).resolves.toBeUndefined();
    await expect(sendTimerCommand("pause")).resolves.toBeUndefined();
    const stopCommands = await listenTimerCommands(() => undefined);
    const stopState = await listenTimerState(() => undefined);
    expect(() => { stopCommands(); stopState(); }).not.toThrow();
  });
});
