import { isTauri } from "./desktop";

/**
 * Per-display geometry memory for the always-on-top mini window. The window
 * position/size is remembered keyed by the monitor it sits on, so a mini window
 * on a second display keeps its own shape while the primary one keeps another.
 * The mini window's view/filter persist globally through the regular
 * preferences (a preset travels with the user, not with the monitor).
 */

export interface MiniGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MiniMonitorBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const STORAGE_KEY = "chronoeon.miniwindow.geometry.v1";
const REMEMBER_DELAY_MS = 500;

type GeometryMap = Record<string, MiniGeometry>;

function isGeometry(value: unknown): value is MiniGeometry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((key) => typeof candidate[key] === "number" && Number.isFinite(candidate[key] as number));
}

function readMap(): GeometryMap {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const map: GeometryMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isGeometry(value)) map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

function writeMap(map: GeometryMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage may be unavailable; the memory then lasts for this session only.
  }
}

/** Best-effort monitor identity: the Tauri monitor name, else a screen-grid key. */
export async function currentMonitorKey(): Promise<string> {
  if (isTauri()) {
    try {
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const monitor = await currentMonitor();
      if (monitor?.name) return `monitor:${monitor.name}`;
    } catch {
      // Fall through to the browser fallback.
    }
  }
  return `screen:${window.screenX ?? 0},${window.screenY ?? 0}`;
}

export async function readMiniGeometry(): Promise<MiniGeometry | null> {
  const key = await currentMonitorKey();
  return readMap()[key] ?? null;
}

export async function rememberMiniGeometry(geometry: MiniGeometry): Promise<void> {
  const key = await currentMonitorKey();
  const map = readMap();
  map[key] = geometry;
  writeMap(map);
}

/** Keep a remembered geometry on-screen when the display layout changed. */
export function clampGeometryToMonitor(geometry: MiniGeometry, monitor: MiniMonitorBounds): MiniGeometry {
  const width = Math.min(Math.max(geometry.width, 1), monitor.width);
  const height = Math.min(Math.max(geometry.height, 1), monitor.height);
  const x = Math.min(Math.max(geometry.x, monitor.x), monitor.x + monitor.width - width);
  const y = Math.min(Math.max(geometry.y, monitor.y), monitor.y + monitor.height - height);
  return { x, y, width, height };
}

/**
 * Report the window's logical geometry on move/resize while the mini window is
 * active, debounced so dragging does not spam localStorage. Returns an
 * unsubscribe function.
 */
export async function observeMiniWindowGeometry(onGeometry: (geometry: MiniGeometry) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { currentMonitor, getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  let timer: number | null = null;

  const read = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      timer = null;
      try {
        const [position, size, monitor] = await Promise.all([
          appWindow.outerPosition(),
          appWindow.outerSize(),
          currentMonitor(),
        ]);
        const scale = monitor?.scaleFactor ?? 1;
        onGeometry({ x: position.x / scale, y: position.y / scale, width: size.width / scale, height: size.height / scale });
      } catch {
        // The window may be closing; a lost sample is fine.
      }
    }, REMEMBER_DELAY_MS);
  };

  const unlistenMoved = await appWindow.onMoved(read);
  const unlistenResized = await appWindow.onResized(read);
  return () => {
    unlistenMoved();
    unlistenResized();
    if (timer !== null) window.clearTimeout(timer);
  };
}
