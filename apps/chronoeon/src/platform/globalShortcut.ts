import { isMobilePlatform } from "../hooks/useTouchDevice";
import { isTauri } from "./desktop";

/**
 * Global OS-level shortcuts. Desktop builds register accelerators so the app
 * can be driven without focus. The registry is keyed by name so several
 * independent shortcuts can coexist; each registration failure (an
 * already-taken combination) is reported instead of thrown.
 */

export const DEFAULT_CAPTURE_SHORTCUT = "CommandOrControl+Shift+Space";
export const DEFAULT_MINI_SHORTCUT = "CommandOrControl+Shift+M";

export type ShortcutRegistration =
  | { status: "registered"; accelerator: string }
  | { status: "conflict"; accelerator: string }
  | { status: "unsupported" };

const active = new Map<string, string>();

function normalizeAccelerator(value: string): string {
  return value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("+");
}

/** True when the accelerator is shaped like a Tauri accelerator string. */
export function isValidAccelerator(value: string): boolean {
  const parts = normalizeAccelerator(value).split("+");
  if (parts.length < 2) return false;
  const modifiers = new Set(["CommandOrControl", "Command", "Control", "Ctrl", "Alt", "Option", "Shift", "Super", "Meta"]);
  const key = parts[parts.length - 1];
  return parts.slice(0, -1).every((part) => modifiers.has(part)) && /^[A-Za-z0-9]+$/.test(key);
}

async function registerNamed(
  name: string,
  accelerator: string,
  onTrigger: () => void
): Promise<ShortcutRegistration> {
  if (!isTauri() || isMobilePlatform()) return { status: "unsupported" };
  const normalized = normalizeAccelerator(accelerator);
  if (!isValidAccelerator(normalized)) return { status: "conflict", accelerator: normalized };
  try {
    const shortcut = await import("@tauri-apps/plugin-global-shortcut");
    const previous = active.get(name);
    if (previous) {
      try {
        await shortcut.unregister(previous);
      } catch {
        // The previous binding may already be gone; continue.
      }
      active.delete(name);
    }
    if (await shortcut.isRegistered(normalized)) return { status: "conflict", accelerator: normalized };
    await shortcut.register(normalized, (event) => {
      // Tauri 2 reports both press and release; only act once.
      if (!event || event.state === "Pressed") onTrigger();
    });
    active.set(name, normalized);
    return { status: "registered", accelerator: normalized };
  } catch (error) {
    console.warn(`Could not register the ${name} global shortcut`, error);
    return { status: "conflict", accelerator: normalized };
  }
}

async function unregisterNamed(name: string): Promise<void> {
  if (!isTauri() || isMobilePlatform()) return;
  const accelerator = active.get(name);
  if (!accelerator) return;
  try {
    const shortcut = await import("@tauri-apps/plugin-global-shortcut");
    await shortcut.unregister(accelerator);
  } catch (error) {
    console.warn(`Could not release the ${name} global shortcut`, error);
  } finally {
    active.delete(name);
  }
}

/** Global quick capture: raise the window and focus the capture field. */
export function registerCaptureShortcut(accelerator: string, onTrigger: () => void): Promise<ShortcutRegistration> {
  return registerNamed("capture", accelerator, onTrigger);
}

export function unregisterCaptureShortcut(): Promise<void> {
  return unregisterNamed("capture");
}

/** Global mini window: enter the mini window, or show/hide it when already compact. */
export function registerMiniShortcut(accelerator: string, onTrigger: () => void): Promise<ShortcutRegistration> {
  return registerNamed("mini", accelerator, onTrigger);
}

export function unregisterMiniShortcut(): Promise<void> {
  return unregisterNamed("mini");
}

/** Human-readable accelerator using the symbols of the current platform. */
export function formatAccelerator(accelerator: string, platform = navigator.platform): string {
  const mac = /mac|iphone|ipad/i.test(platform);
  return normalizeAccelerator(accelerator)
    .split("+")
    .map((part) => {
      if (part === "CommandOrControl") return mac ? "⌘" : "Ctrl";
      if (part === "Command" || part === "Meta" || part === "Super") return mac ? "⌘" : "Win";
      if (part === "Control" || part === "Ctrl") return "Ctrl";
      if (part === "Alt" || part === "Option") return mac ? "⌥" : "Alt";
      if (part === "Shift") return mac ? "⇧" : "Shift";
      return part;
    })
    .join(mac ? "" : " + ");
}
