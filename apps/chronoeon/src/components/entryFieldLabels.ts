import { formatClockMinutes, parseClockMinutes, resolveReminderTime, type EntryDraft, type Recurrence, type Reminder } from "@chronoeon/domain";
import type { EntryPriority } from "@chronoeon/domain";
import type { Locale } from "../domain/entry";
import { localeTag, t, type MessageKey } from "../i18n";
import type { GlassSelectOption } from "./GlassSelect";

/** Shared by the entry composer and the Capture review card. */
export const recurrenceOptions: Array<{ value: Recurrence; key: MessageKey }> = [
  { value: "none", key: "recurrenceNone" },
  { value: "daily", key: "recurrenceDaily" },
  { value: "weekly", key: "recurrenceWeekly" },
  { value: "monthly", key: "recurrenceMonthly" },
  { value: "yearly", key: "recurrenceYearly" },
];

/** Every reminder value the shared domain can resolve, in both time modes. */
export const reminderLabels: Record<Reminder, MessageKey> = {
  none: "reminderNone",
  "at-time": "reminderAtTime",
  "5min": "reminder5min",
  "15min": "reminder15min",
  "30min": "reminder30min",
  "1hour": "reminder1hour",
  "2hour": "reminder2hour",
  "12hour": "reminder12hour",
  "1day": "reminder1day",
  "1week": "reminder1week",
  "day-9am": "reminderDay9am",
  "day-before-9am": "reminderPreviousDay9am",
  "day-before-5pm": "reminderPreviousDay5pm",
  "week-before-9am": "reminderPreviousWeek9am",
};

/** Priority and urgency share one two-value scale in both composers. */
export const priorities: Array<{ value: EntryPriority; key: MessageKey }> = [
  { value: "low", key: "priorityLow" },
  { value: "high", key: "priorityHigh" },
];

export function labeledOptions<Value extends string>(items: Array<{ value: Value; key: MessageKey }>, locale: Locale): GlassSelectOption[] {
  return items.map(({ value, key }) => ({ value, label: t(key, locale) }));
}

/** The weekday of an ISO civil date, 0 = Sunday; the recurrence day index. */
export function weekdayIndexForDate(date: string | undefined): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay() : 1;
}

/** One letter per day in both locales: seven circles have to stay narrow. */
export const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];

export function weekdayTitles(locale: Locale): string[] {
  return locale === "zh"
    ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
}

/**
 * When a relative reminder actually fires. "15 minutes before" is ambiguous on
 * its own, so every surface that offers a reminder shows this resolved time.
 */
export function reminderTriggerLabel(draft: Pick<EntryDraft, "allDay" | "date" | "reminder" | "start">, locale: Locale): string {
  if (!draft.reminder || draft.reminder === "none") return "";
  const trigger = resolveReminderTime({
    date: draft.date,
    start: draft.start,
    allDay: draft.allDay,
    reminder: draft.reminder,
  });
  if (!trigger) return "";
  // Always a 24-hour clock: the app's dials are 24h, and dropping AM/PM keeps
  // this hint short enough to sit beside the reminder's own label.
  return trigger.toLocaleString(localeTag[locale], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * The end clock a draft gets when it has none: the start plus the settings'
 * slot length, wrapped inside the civil day.
 */
export function endClockAfter(start: string | undefined, timeScale: number): string | undefined {
  const minutes = parseClockMinutes(start);
  return minutes === null ? undefined : formatClockMinutes((minutes + timeScale) % (24 * 60));
}
