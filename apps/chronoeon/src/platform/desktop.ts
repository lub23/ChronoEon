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

export type DesktopWindowAction = "minimize" | "toggle-maximize" | "close";
export type DesktopResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";

interface NormalWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

const NORMAL_GEOMETRY_KEY = "chronoeon.window.normal.v1";

function readNormalGeometry(): NormalWindowGeometry | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(NORMAL_GEOMETRY_KEY) ?? "null") as NormalWindowGeometry | null;
    if (!value || ["x", "y", "width", "height", "maximized"].some((key) => !(key in value))) return null;
    return value;
  } catch {
    return null;
  }
}

function writeNormalGeometry(geometry: NormalWindowGeometry): void {
  try {
    window.localStorage.setItem(NORMAL_GEOMETRY_KEY, JSON.stringify(geometry));
  } catch {
    // Without storage the next restore uses the standard desktop size.
  }
}

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

/** Hide or re-show the mini window; returns the new visibility. */
export async function toggleMiniWindowVisible(): Promise<boolean> {
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  if (await appWindow.isVisible()) {
    await appWindow.hide();
    return false;
  }
  await appWindow.show();
  await appWindow.setFocus();
  return true;
}

export async function setCompactWindow(
  compact: boolean,
  options: { captureNormal?: boolean } = {},
): Promise<void> {
  if (!isTauri()) return;
  const [{ getCurrentWindow, currentMonitor }, { LogicalPosition, LogicalSize }, { clampGeometryToMonitor, readMiniGeometry }] = await Promise.all([
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/dpi"),
    import("./miniWindow")
  ]);
  const appWindow = getCurrentWindow();

  if (compact && options.captureNormal !== false) {
    const monitor = await currentMonitor();
    const scale = monitor?.scaleFactor ?? 1;
    const maximized = await appWindow.isMaximized();
    const position = await appWindow.outerPosition();
    const size = await appWindow.outerSize();
    writeNormalGeometry({
      x: position.x / scale,
      y: position.y / scale,
      width: size.width / scale,
      height: size.height / scale,
      maximized,
    });
    if (maximized) await appWindow.unmaximize();
  }

  await appWindow.setAlwaysOnTop(compact);
  // The mini window remains resizable so both its list and one-day timeline
  // can adapt instead of being locked to one hard-coded viewport.
  await appWindow.setResizable(true);
  // Resize can reset native chrome permissions on some platforms, so the
  // maximize rejection is deliberately the last window-capability call.
  await appWindow.setMaximizable(!compact);
  if (compact) {
    const saved = await readMiniGeometry();
    if (saved) {
      // Clamp to the current monitor so a changed display layout never parks
      // the window off-screen or larger than the desktop.
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const monitor = await currentMonitor();
      const scale = monitor?.scaleFactor ?? 1;
      const target = monitor
        ? clampGeometryToMonitor(saved, {
            x: monitor.position.x / scale,
            y: monitor.position.y / scale,
            width: monitor.size.width / scale,
            height: monitor.size.height / scale,
          })
        : saved;
      // Geometry memory keeps position and a bounded height; every mini entry
      // resets width so a utility switch cannot reopen as a wide window.
      await appWindow.setSize(new LogicalSize(320, Math.max(480, Math.min(target.height, 660))));
      await appWindow.setPosition(new LogicalPosition(target.x, target.y));
      return;
    }
    await appWindow.setSize(new LogicalSize(320, 660));
    await appWindow.center();
    return;
  }

  const original = readNormalGeometry();
  if (original?.maximized) {
    await appWindow.maximize();
    return;
  }
  if (original) {
    await appWindow.setSize(new LogicalSize(original.width, original.height));
    await appWindow.setPosition(new LogicalPosition(original.x, original.y));
    return;
  }
  await appWindow.setSize(new LogicalSize(1240, 800));
  await appWindow.center();
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
