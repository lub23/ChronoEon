import { useCallback, useEffect, useRef, useState } from "react";
import { dueReminders, formatEntryTime, type DueReminder, type Entry, type Locale } from "@chronoeon/domain";
import { categoryLabel, compositeCategoryLabel, t } from "../i18n";
import { backgroundTimingSupported, configureBackground, consumeBackgroundReminders, acknowledgeBackgroundReminders } from "../platform/background";
import {
  notificationPermission,
  requestNotificationPermission,
  showSystemNotification,
  type NotificationPermissionState
} from "../platform/notifications";

/** Desktop/browser reconciliation; Android delegates alarms to the OS and
 * only consumes delivery receipts for its optional foreground reminder sheet.
 * Schedules are always derived from SQLite, never from Markdown or a WebView timer. */

const POLL_MS = 30_000;
const DELIVERED_KEY = "chronoeon.reminders.delivered";
const MAX_REMEMBERED = 400;

function reminderCategory(entry: Entry, locale: Locale): string {
  return entry.kind === "bill"
    ? compositeCategoryLabel(entry.category, locale)
    : categoryLabel(entry.category, locale, entry.category);
}

function reminderDetail(entry: Entry, locale: Locale): string {
  const when = entry.allDay ? t("allDay", locale) : formatEntryTime(entry, locale);
  return [
    when ? `${t("reminderStarts", locale)} ${when}` : "",
    entry.location || "",
    entry.note?.replace(/\s+/g, " ").trim().slice(0, 140) || "",
    reminderCategory(entry, locale),
  ].filter(Boolean).join(" · ");
}

function readDelivered(): string[] {
  try {
    const raw = window.localStorage.getItem(DELIVERED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeDelivered(keys: string[]): void {
  try {
    window.localStorage.setItem(DELIVERED_KEY, JSON.stringify(keys.slice(-MAX_REMEMBERED)));
  } catch {
    // Storage may be unavailable; de-duplication then lasts for this session.
  }
}

export interface ReminderOptions {
  entries: Entry[];
  locale: Locale;
  enabled: boolean;
  ready?: boolean;
  onError?: (error: unknown) => void;
  /** App-owned reminder surface; always fires, even if OS delivery fails. */
  onRemind: (due: DueReminder[]) => void;
}

export interface ReminderController {
  permission: NotificationPermissionState;
  /** Ask the OS for permission from an explicit user action. */
  requestPermission: () => Promise<NotificationPermissionState>;
  /** Re-run reconciliation now, used after a vault refresh or on demand. */
  reconcile: () => void;
}

export function useReminders({ entries, locale, enabled, ready = true, onError, onRemind }: ReminderOptions): ReminderController {
  const [permission, setPermission] = useState<NotificationPermissionState>("denied");
  const native = backgroundTimingSupported();
  const delivered = useRef<Set<string>>(new Set(native ? [] : readDelivered()));
  const errorRef = useRef(onError); errorRef.current = onError;
  const failed = useRef(false);
  const reading = useRef(false);
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const readyRef = useRef(ready); readyRef.current = ready;
  const entriesRef = useRef(entries);
  const localeRef = useRef(locale);
  const remindRef = useRef(onRemind);
  entriesRef.current = entries;
  localeRef.current = locale;
  remindRef.current = onRemind;

  useEffect(() => {
    let disposed = false;
    void notificationPermission().then((state) => { if (!disposed) setPermission(state); });
    return () => { disposed = true; };
  }, []);

  const reportFailure = useCallback((error: unknown) => { if (!failed.current) errorRef.current?.(error); failed.current = true; }, []);
  const reconcile = useCallback(() => {
    if (!enabledRef.current || !readyRef.current) return;
    if (native) {
      if (document.hidden || reading.current) return;
      reading.current = true;
      void consumeBackgroundReminders().then(({ keys }) => {
        failed.current = false;
        if (!enabledRef.current || document.hidden) return;
        const receipt = new Set(keys);
        const due = dueReminders(entriesRef.current).filter(reminder => receipt.has(reminder.key) && !delivered.current.has(reminder.key));
        due.forEach(reminder => delivered.current.add(reminder.key));
        if (due.length) remindRef.current(due);
        return acknowledgeBackgroundReminders(keys);
      }).catch(reportFailure).finally(() => { reading.current = false; });
      return;
    }
    const activeLocale = localeRef.current;
    const due = dueReminders(entriesRef.current).filter((reminder) => !delivered.current.has(reminder.key));
    if (due.length === 0) return;

    const announceOne = (reminder: (typeof due)[number]) => {
      const title = reminder.entry.title || t("reminderTitle", activeLocale);
      const detail = reminderDetail(reminder.entry, activeLocale);
      void showSystemNotification({
        title: `🔔 ${t("reminderTitle", activeLocale)}`,
        body: detail ? `${title}\n${detail}` : title,
        tag: `chronoeon-reminder-${reminder.entry.id}`,
      });
    };

    for (const reminder of due) delivered.current.add(reminder.key);
    if (due.length <= 3) {
      for (const reminder of due) announceOne(reminder);
    } else {
      // Waking from sleep can surface a whole backlog at once: aggregate it
      // into one announcement and one system notification instead of a burst.
      const titles = due.slice(0, 3).map((reminder) => reminder.entry.title || t("reminderTitle", activeLocale));
      const summary = `${due.length} ${t("remindersDue", activeLocale)}`;
      const detail = `${titles.join(" · ")}${due.length > 3 ? " · …" : ""}`;
      void showSystemNotification({
        title: `🔔 ${t("remindersAggregated", activeLocale)} · ${summary}`,
        body: detail,
        tag: "chronoeon-reminders-batch",
      });
    }
    remindRef.current(due);
    writeDelivered([...delivered.current]);
  }, [native, reportFailure]);

  useEffect(() => {
    if (!ready) return;
    if (native) {
      void configureBackground(locale, enabled).then(() => { failed.current = false; reconcile(); }).catch(reportFailure);
    } else reconcile();
  }, [entries, locale, enabled, ready, native, reconcile, reportFailure]);

  useEffect(() => {
    if (!enabled || !ready) return;
    let id: number | undefined;
    const schedule = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
      if (!native || !document.hidden) id = window.setInterval(reconcile, POLL_MS);
    };
    schedule();
    // A machine waking from sleep skipped its intervals; recheck immediately.
    const onVisible = () => { schedule(); if (!document.hidden) {
      if (native) void configureBackground(localeRef.current, enabledRef.current).then(reconcile).catch(reportFailure);
      else reconcile();
    } };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, ready, native, reconcile, reportFailure]);

  const requestPermission = useCallback(async () => {
    const next = await requestNotificationPermission();
    setPermission(next);
    if (native && readyRef.current) await configureBackground(localeRef.current, enabledRef.current).then(reconcile).catch(reportFailure);
    return next;
  }, [native, reconcile, reportFailure]);

  return { permission, requestPermission, reconcile };
}
