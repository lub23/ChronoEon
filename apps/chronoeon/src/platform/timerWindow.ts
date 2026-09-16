import type { Locale, TimerSession } from "@chronoeon/domain";
import { isTauri } from "./desktop";

/**
 * Second always-on-top window that mirrors the running timer. The main window
 * stays the only owner of the session; it broadcasts state and executes the
 * commands the overlay sends back. Outside Tauri every function is a no-op so
 * the browser demo and tests never touch window APIs.
 */

export const TIMER_WINDOW_LABEL = "timer";
export const TIMER_STATE_EVENT = "timer:state";
export const TIMER_COMMAND_EVENT = "timer:command";
export const TIMER_HELLO_EVENT = "timer:hello";

export type TimerCommand = "pause" | "resume" | "stop" | "open" | "hide";

const WINDOW_WIDTH = 320;
const WINDOW_HEIGHT = 112;

// Window creation is asynchronous. A close queued during creation must run
// afterwards, and simultaneous pin/start actions must not create the same label twice.
let windowQueue: Promise<void> = Promise.resolve();
function queueWindowChange(work: () => Promise<void>): Promise<void> {
  const next = windowQueue.then(work);
  windowQueue = next.catch(() => undefined);
  return next;
}
export function openTimerWindow(locale: Locale = "en"): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return queueWindowChange(async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    if (await WebviewWindow.getByLabel(TIMER_WINDOW_LABEL)) return;
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const monitor = await currentMonitor().catch(() => null);
    const scale = monitor?.scaleFactor ?? 1;
    const x = monitor ? monitor.position.x / scale + monitor.size.width / scale - WINDOW_WIDTH - 24 : 120;
    const y = monitor ? monitor.position.y / scale + monitor.size.height / scale - WINDOW_HEIGHT - 80 : 120;
    const url = window.location.pathname + "?timer=1";
    await new Promise<void>((resolve, reject) => {
      const created = new WebviewWindow(TIMER_WINDOW_LABEL, {
        url, title: locale === "zh" ? "时元 · 计时" : "ChronoEon · Timer",
        width: WINDOW_WIDTH, height: WINDOW_HEIGHT, x, y,
        alwaysOnTop: true, decorations: false, resizable: false, skipTaskbar: true, focus: false, shadow: true,
      });
      void created.once("tauri://created", () => resolve()).catch(reject);
      void created.once("tauri://error", (event) => reject(new Error(String(event.payload)))).catch(reject);
    });
  });
}
export function closeTimerWindow(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return queueWindowChange(async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(TIMER_WINDOW_LABEL);
    if (existing) await existing.close();
  });
}

/** Main window → overlay. */
export async function emitTimerState(session: TimerSession | null): Promise<void> {
  if (!isTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(TIMER_STATE_EVENT, session);
}

/** Main window: run overlay commands. Returns an unsubscribe function. */
export async function listenTimerCommands(handler: (command: TimerCommand) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const commands = await listen<TimerCommand>(TIMER_COMMAND_EVENT, (event) => handler(event.payload));
  try {
    const hello = await listen(TIMER_HELLO_EVENT, () => handler("open"));
    return () => { commands(); hello(); };
  } catch (error) { commands(); throw error; }
}

/** Overlay: receive state pushes. Returns an unsubscribe function. */
export async function listenTimerState(handler: (session: TimerSession | null) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen, emit } = await import("@tauri-apps/api/event");
  const unlisten = await listen<TimerSession | null>(TIMER_STATE_EVENT, (event) => handler(event.payload));
  try { await emit(TIMER_HELLO_EVENT); return unlisten; }
  catch (error) { unlisten(); throw error; }
}

/** Overlay → main window. */
export async function sendTimerCommand(command: TimerCommand): Promise<void> {
  if (!isTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(TIMER_COMMAND_EVENT, command);
}
