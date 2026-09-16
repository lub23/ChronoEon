import { isTauri } from "./desktop";

/**
 * Reminder delivery. Tauri desktop builds use the OS notification plugin so a
 * reminder still surfaces while ChronoEon is minimised; browsers fall back to
 * the Web Notification API. Both paths are optional: when permission is refused
 * the caller still shows the in-app toast, so a reminder is never lost silently.
 */

export type NotificationPermissionState = "granted" | "denied" | "unsupported";

let cachedPermission: NotificationPermissionState | null = null;

export async function notificationPermission(): Promise<NotificationPermissionState> {
  if (cachedPermission) return cachedPermission;
  if (isTauri()) {
    try {
      const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
      cachedPermission = (await isPermissionGranted()) ? "granted" : "denied";
      return cachedPermission;
    } catch {
      cachedPermission = "unsupported";
      return cachedPermission;
    }
  }
  if (typeof Notification === "undefined") {
    cachedPermission = "unsupported";
    return cachedPermission;
  }
  cachedPermission = Notification.permission === "granted" ? "granted" : "denied";
  return cachedPermission;
}

/**
 * Ask for notification permission. Called only from an explicit user action
 * (enabling reminders in settings) so no launch-time permission prompt appears.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  cachedPermission = null;
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted()) {
        cachedPermission = "granted";
        return cachedPermission;
      }
      const result = await requestPermission();
      cachedPermission = result === "granted" ? "granted" : "denied";
      return cachedPermission;
    } catch {
      cachedPermission = "unsupported";
      return cachedPermission;
    }
  }
  if (typeof Notification === "undefined") {
    cachedPermission = "unsupported";
    return cachedPermission;
  }
  try {
    const result = await Notification.requestPermission();
    cachedPermission = result === "granted" ? "granted" : "denied";
  } catch {
    cachedPermission = "denied";
  }
  return cachedPermission;
}

export interface SystemNotification {
  title: string;
  body: string;
  /** Coalescing tag so repeated checks replace rather than stack notifications. */
  tag?: string;
  /** Stable numeric id; re-sending with the same id replaces the card (Tauri). */
  id?: number;
  /** Android: keep the card in the shade until removed programmatically. */
  ongoing?: boolean;
  /** Android: remove the card when tapped. */
  autoCancel?: boolean;
}

/** Deliver one OS notification. Resolves `false` when the platform refused. */
export async function showSystemNotification(notification: SystemNotification): Promise<boolean> {
  const permission = await notificationPermission();
  if (permission !== "granted") return false;
  if (isTauri()) {
    try {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      await sendNotification({
        title: notification.title,
        body: notification.body,
        ...(notification.id !== undefined ? { id: notification.id } : {}),
        ...(notification.ongoing !== undefined ? { ongoing: notification.ongoing } : {}),
        ...(notification.autoCancel !== undefined ? { autoCancel: notification.autoCancel } : {}),
      });
      return true;
    } catch (error) {
      console.warn("Could not send a system notification", error);
      return false;
    }
  }
  try {
    const instance = new Notification(notification.title, { body: notification.body, tag: notification.tag });
    instance.onclick = () => {
      try {
        window.focus();
      } catch {
        // Focus may be blocked by the browser; the notification still showed.
      }
      instance.close();
    };
    return true;
  } catch (error) {
    console.warn("Could not send a browser notification", error);
    return false;
  }
}

/** Remove a delivered card by id. Browsers have no handle to it; a no-op there. */
export async function dismissSystemNotification(id: number): Promise<void> {
  if (!isTauri()) return;
  try {
    const { removeActive, cancel } = await import("@tauri-apps/plugin-notification");
    await removeActive([{ id }]);
    await cancel([id]).catch(() => undefined);
  } catch {
    // The platform may not track delivered cards (older desktops); nothing to clear.
  }
}

/** Bring the app forward, used by reminders and the global capture shortcut. */
export async function focusAppWindow(): Promise<void> {
  if (!isTauri()) {
    try {
      window.focus();
    } catch {
      // Ignored: browsers may refuse programmatic focus.
    }
    return;
  }
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    if (await appWindow.isMinimized()) await appWindow.unminimize();
    await appWindow.show();
    await appWindow.setFocus();
  } catch (error) {
    console.warn("Could not focus the ChronoEon window", error);
  }
}
