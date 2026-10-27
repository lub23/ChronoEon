declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

/** Android's Tauri shell needs its own file-picker and sync scheduling. */
export function isAndroidTauri(): boolean {
  return isTauri() && /Android/i.test(navigator.userAgent);
}

/** The running build. Native shells report their bundle version; the browser
 *  demo reports the workspace version Vite embedded at build time. */
export async function readAppVersion(): Promise<string> {
  if (!isTauri()) return __APP_VERSION__;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return __APP_VERSION__;
  }
}

export type DesktopWindowAction = "minimize" | "toggle-maximize" | "close";
export type DesktopResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";

let requestedMinimumWidth: number | undefined;
let appliedMinimumWidth: number | undefined;
let pendingMinimumWidth: number | undefined;
let changingMaximize = 0;

export async function performDesktopWindowAction(action: DesktopWindowAction): Promise<boolean> {
  if (!isTauri()) return false;
  if (action === "toggle-maximize") changingMaximize += 1;
  let maximized = false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    if (action === "toggle-maximize") { await appWindow.toggleMaximize(); maximized = await appWindow.isMaximized(); }
    if (action === "close") await appWindow.close();
  } finally {
    if (action === "toggle-maximize") changingMaximize -= 1;
  }
  if (action === "toggle-maximize" && !maximized && requestedMinimumWidth !== undefined)
    await setDesktopMinimumWidth(requestedMinimumWidth);
  return maximized;
}

export async function observeDesktopMaximized(listener: (maximized: boolean) => void): Promise<() => void> {
  if (!isTauri()) {
    listener(false);
    return () => undefined;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  const report = async () => {
    const maximized = await appWindow.isMaximized();
    listener(maximized);
    if (!maximized && requestedMinimumWidth !== undefined) await setDesktopMinimumWidth(requestedMinimumWidth);
  };
  await report();
  return appWindow.onResized(() => { void report(); });
}

export async function startDesktopResize(direction: DesktopResizeDirection): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startResizeDragging(direction);
}

export async function startDesktopDrag(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

/** The titlebar measures its own non-shrinking controls; never hide native actions. */
export async function setDesktopMinimumWidth(width: number): Promise<void> {
  if (!isTauri() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
  const next = Math.max(320, Math.ceil(width));
  requestedMinimumWidth = next;
  if (next === appliedMinimumWidth || next === pendingMinimumWidth || changingMaximize) return;
  pendingMinimumWidth = next;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const appWindow = getCurrentWindow();
    // Tao's Windows set_min_inner_size calls set_inner_size, which clears the
    // native maximized flag and overwrites restored bounds. Never reapply an
    // unchanged constraint from ResizeObserver, or apply one while maximizing.
    if (await appWindow.isMaximized() || changingMaximize || next === appliedMinimumWidth || next !== requestedMinimumWidth) return;
    const previous = appliedMinimumWidth;
    appliedMinimumWidth = next;
    try { await appWindow.setMinSize(new LogicalSize(next, 540)); }
    catch (error) { if (appliedMinimumWidth === next) appliedMinimumWidth = previous; throw error; }
  } finally {
    if (pendingMinimumWidth === next) pendingMinimumWidth = undefined;
  }
}
