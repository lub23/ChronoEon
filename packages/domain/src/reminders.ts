import { addIsoDays, entriesForDate, isIsoDate, isoDateRange, parseClockMinutes } from "./calendar";
import type { Entry, Reminder } from "./entry";

/** Reminder offsets expressed as whole minutes before the entry begins. */
const RELATIVE_MINUTES: Partial<Record<Reminder, number>> = {
  "at-time": 0,
  "5min": 5,
  "15min": 15,
  "30min": 30,
  "1hour": 60,
  "2hour": 120,
  "12hour": 720,
  "1day": 1440,
  "1week": 10080
};

/** Reminder values pinned to a wall-clock hour relative to the entry date. */
const ABSOLUTE_ANCHORS: Partial<Record<Reminder, { dayOffset: number; hour: number; minute: number }>> = {
  "day-9am": { dayOffset: 0, hour: 9, minute: 0 },
  "day-before-9am": { dayOffset: -1, hour: 9, minute: 0 },
  "day-before-5pm": { dayOffset: -1, hour: 17, minute: 0 },
  "week-before-9am": { dayOffset: -7, hour: 9, minute: 0 }
};

export const TIMED_REMINDERS: Reminder[] = [
  "none", "at-time", "5min", "15min", "30min", "1hour", "2hour", "12hour", "1day", "1week"
];

export const ALL_DAY_REMINDERS: Reminder[] = [
  "none", "day-9am", "day-before-9am", "day-before-5pm", "week-before-9am"
];

/** Reminders are compared against local wall-clock time, like the calendar itself. */
function localDateTime(date: string, minutesOfDay: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const value = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Math.floor(minutesOfDay / 60),
    minutesOfDay % 60,
    0,
    0
  );
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * Resolve the moment a reminder should fire for an entry (or a materialized
 * recurring occurrence). Returns `null` when the entry does not ask for one.
 */
export function resolveReminderTime(
  entry: Pick<Entry, "date" | "start" | "allDay" | "reminder">
): Date | null {
  const reminder = entry.reminder ?? "none";
  if (reminder === "none" || !isIsoDate(entry.date)) return null;

  const anchor = ABSOLUTE_ANCHORS[reminder];
  if (anchor) {
    return localDateTime(addIsoDays(entry.date, anchor.dayOffset), anchor.hour * 60 + anchor.minute);
  }

  const offset = RELATIVE_MINUTES[reminder];
  if (offset === undefined) return null;
  const beginMinutes = entry.allDay ? 0 : parseClockMinutes(entry.start) ?? 0;
  const begin = localDateTime(entry.date, beginMinutes);
  return begin ? new Date(begin.getTime() - offset * 60_000) : null;
}

export interface DueReminder {
  /** Projected entry, so a recurring occurrence keeps its own date and time. */
  entry: Entry;
  /** Stable per-fire key: repeated scans of the same occurrence de-duplicate. */
  key: string;
  triggerAt: Date;
}

export interface ReminderScanOptions {
  now?: Date;
  /** How late a reminder may still surface after its trigger (default 15 min). */
  graceMs?: number;
  /** Days scanned before/after `now`; covers 1-week-before reminders. */
  lookBehindDays?: number;
  lookAheadDays?: number;
}

const DEFAULT_GRACE_MS = 15 * 60_000;

function isoDay(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Collect reminders whose trigger moment already passed but is still inside the
 * grace window. Recurring series are expanded per civil day so each occurrence
 * gets its own reminder without persisting anything.
 */
export function dueReminders(entries: Entry[], options: ReminderScanOptions = {}): DueReminder[] {
  const now = options.now ?? new Date();
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  // Absolute anchors can point a week back; scanning enough history keeps a
  // missed week-before reminder from silently disappearing.
  const behind = options.lookBehindDays ?? 8;
  const ahead = options.lookAheadDays ?? 8;
  const today = isoDay(now);
  const dates = isoDateRange(addIsoDays(today, -behind), addIsoDays(today, ahead));

  const due: DueReminder[] = [];
  const seen = new Set<string>();
  for (const date of dates) {
    for (const entry of entriesForDate(entries, date)) {
      if (!entry.reminder || entry.reminder === "none") continue;
      if (entry.kind === "task" && (entry.status === "done" || entry.status === "cancelled")) continue;
      const triggerAt = resolveReminderTime(entry);
      if (!triggerAt) continue;
      const age = now.getTime() - triggerAt.getTime();
      if (age < 0 || age > graceMs) continue;
      const key = `${entry.recurrenceSourceId ?? entry.id}:${entry.occurrenceDate ?? entry.date}:${triggerAt.getTime()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      due.push({ entry, key, triggerAt });
    }
  }
  return due.sort((left, right) => left.triggerAt.getTime() - right.triggerAt.getTime());
}

/**
 * Next upcoming reminder for an entry, used by the UI to show when a saved
 * reminder will actually surface.
 */
export function nextReminderAt(entries: Entry[], from = new Date(), horizonDays = 30): Date | null {
  const today = isoDay(from);
  const dates = isoDateRange(today, addIsoDays(today, horizonDays));
  let best: Date | null = null;
  for (const date of dates) {
    for (const entry of entriesForDate(entries, date)) {
      const triggerAt = resolveReminderTime(entry);
      if (!triggerAt || triggerAt.getTime() < from.getTime()) continue;
      if (!best || triggerAt.getTime() < best.getTime()) best = triggerAt;
    }
  }
  return best;
}
