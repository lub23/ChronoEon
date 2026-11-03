import type { Locale } from "@chronoeon/domain";
import { isTauri } from "./desktop";

/**
 * Spotlight-style quick capture: a second, always-on-top window that owns its
 * own database session, parses while the user types and hides when done. The
 * main window only creates/raises it and listens for what it saved.
 */

export const QUICK_WINDOW_LABEL = "quick";
export const QUICK_SAVED_EVENT = "chronoeon:quick-saved";
export const QUICK_MANUAL_EVENT = "chronoeon:quick-manual";
export const QUICK_OPEN_EVENT = "chronoeon:quick-open";
export const QUICK_WINDOW_WIDTH = 640;
export const QUICK_WINDOW_HEIGHT = 172;

let windowQueue: Promise<unknown> = Promise.resolve();
function queueWindowChange<T>(work: () => Promise<T>): Promise<T> {
  const next = windowQueue.then(work);
  windowQueue = next.catch(() => undefined);
  return next;
}

/** Main window: create the quick window or bring the existing one forward. */
export function openQuickCaptureWindow(locale: Locale): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  return queueWindowChange(async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { emit } = await import("@tauri-apps/api/event");
    const existing = await WebviewWindow.getByLabel(QUICK_WINDOW_LABEL);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      await emit(QUICK_OPEN_EVENT);
      return true;
    }
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const monitor = await currentMonitor().catch(() => null);
    const scale = monitor?.scaleFactor ?? 1;
    const screenWidth = monitor ? monitor.size.width / scale : 1280;
    const screenHeight = monitor ? monitor.size.height / scale : 800;
    const originX = monitor ? monitor.position.x / scale : 0;
    const originY = monitor ? monitor.position.y / scale : 0;
    const x = Math.round(originX + (screenWidth - QUICK_WINDOW_WIDTH) / 2);
    const y = Math.round(originY + screenHeight * 0.2);
    const url = window.location.pathname + "?quick=1";
    await new Promise<void>((resolve, reject) => {
      const created = new WebviewWindow(QUICK_WINDOW_LABEL, {
        url, title: locale === "zh" ? "时元 · 快捷录入" : "ChronoEon · Quick capture",
        width: QUICK_WINDOW_WIDTH, height: QUICK_WINDOW_HEIGHT, x, y,
        alwaysOnTop: true, decorations: false, resizable: false, skipTaskbar: true, focus: true, shadow: false, transparent: true, backgroundColor: "#00000000",
      });
      void created.once("tauri://created", () => resolve()).catch(reject);
      void created.once("tauri://error", (event) => reject(new Error(String(event.payload)))).catch(reject);
    });
    return true;
  });
}

/** Main window: react to what the quick window did. Returns an unsubscribe function. */
export async function listenQuickCaptureEvents(handlers: { onSaved: (count: number) => void; onManual: (text: string) => void }): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const saved = await listen<{ count: number }>(QUICK_SAVED_EVENT, (event) => handlers.onSaved(event.payload?.count ?? 0));
  try {
    const manual = await listen<{ text: string }>(QUICK_MANUAL_EVENT, (event) => handlers.onManual(event.payload?.text ?? ""));
    return () => { saved(); manual(); };
  } catch (error) { saved(); throw error; }
}

/** Quick window → main window. */
export async function emitQuickSaved(count: number): Promise<void> {
  if (!isTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(QUICK_SAVED_EVENT, { count });
}
export async function emitQuickManual(text: string): Promise<void> {
  if (!isTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(QUICK_MANUAL_EVENT, { text });
}

/** Quick window: the main window asked us to come forward again. */
export async function listenQuickOpen(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen(QUICK_OPEN_EVENT, () => handler());
}

export async function hideQuickWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

/** Quick window: hide when focus leaves it, unless a native dialog took the focus. */
export async function observeQuickWindowFocus(handler: (focused: boolean) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onFocusChanged(({ payload }) => handler(payload));
}

export interface QuickWindowSpace { below: number; above: number }

/** Free vertical space around the window on its monitor, in logical pixels. */
export async function quickWindowSpace(): Promise<QuickWindowSpace> {
  if (!isTauri()) return { below: window.innerHeight, above: 0 };
  const { currentMonitor, getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  const [monitor, position, scale] = await Promise.all([currentMonitor().catch(() => null), current.outerPosition(), current.scaleFactor()]);
  if (!monitor) return { below: 600, above: 0 };
  const top = position.y / scale;
  const monitorTop = monitor.position.y / scale;
  const monitorBottom = monitorTop + monitor.size.height / scale;
  return { below: monitorBottom - top - QUICK_WINDOW_HEIGHT - 56, above: top - monitorTop - 16 };
}

/**
 * Grow or shrink the window to the content. When the results sit above the
 * input the top edge moves so the input itself never jumps on screen.
 */
let anchorY: number | null = null;
let lastHeight = QUICK_WINDOW_HEIGHT;
let lastAbove = false;
export async function resizeQuickWindow(height: number, above: boolean): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow, LogicalPosition, LogicalSize } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  const scale = await current.scaleFactor();
  const position = await current.outerPosition();
  const x = position.x / scale;
  if (anchorY === null) anchorY = position.y / scale + (lastAbove ? lastHeight - QUICK_WINDOW_HEIGHT : 0);
  const target = Math.max(QUICK_WINDOW_HEIGHT, Math.round(height));
  const y = above ? anchorY - (target - QUICK_WINDOW_HEIGHT) : anchorY;
  if (Math.abs(position.y / scale - y) >= 1) await current.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
  await current.setSize(new LogicalSize(QUICK_WINDOW_WIDTH, target));
  lastHeight = target; lastAbove = above;
}

export async function quickWindowFocused(): Promise<boolean> {
  if (!isTauri()) return document.hasFocus();
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().isFocused();
}
export async function dragQuickWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}
export function resetQuickWindowAnchor(): void { anchorY = null; }
