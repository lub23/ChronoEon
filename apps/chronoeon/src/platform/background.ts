import { invoke } from "@tauri-apps/api/core";
import type { Locale, TimerSession } from "@chronoeon/domain";
import { isAndroidTauri } from "./desktop";

export interface BackgroundStatus {
  exactAlarms: boolean; notifications: boolean; timerRunning: boolean; batteryRestricted: boolean; nextAlarmAt: number;
}
export class BackgroundTimingError extends Error { constructor() { super("Native background timing is unavailable"); this.name = "BackgroundTimingError"; } }
export const backgroundTimingSupported = () => isAndroidTauri();
let operations: Promise<unknown> = Promise.resolve();
/** Serialize native commands, so a delayed start cannot resurrect a paused or
 * cancelled session. The native side always re-reads the authoritative SQLite row. */
function command<T>(action: string, values: Record<string, unknown> = {}): Promise<T> {
  const task = operations.then(() => invoke<T>("background_command", { action, ...values }));
  operations = task.catch(() => undefined);
  return task.catch(() => { throw new BackgroundTimingError(); });
}
export const configureBackground = (language: Locale, remindersEnabled: boolean) => command<BackgroundStatus>("sync", { language, remindersEnabled });
export const syncBackgroundTimer = () => command<BackgroundStatus>("timerSync");
export const backgroundTimerSnapshot = () => command<{ session: TimerSession | null }>("timerSnapshot");
export const consumeBackgroundReminders = () => command<{ keys: string[] }>("consumeReminders");
export const acknowledgeBackgroundReminders = (keys: string[]) => command<void>("ackReminders", { keys });
export const backgroundStatus = () => command<BackgroundStatus>("status");
export const openBackgroundSettings = (target: "alarms" | "battery") => command<void>(target === "alarms" ? "alarmSettings" : "batterySettings");
