import { billDirectionForCategory, DEFAULT_CHRONOEON_SETTINGS, type ChronoEonSettings } from "./settings";
import type { Locale } from "./entry";

const CALENDAR_DATE_TIME = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):([0-5]\d)(?::[0-5]\d)?)?$/;

export interface CalendarTimeItem {
  allDay?: boolean;
  begin?: string;
  end?: string;
  modality?: "task" | "event" | "bill" | "idea";
}

function dateOrdinal(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const value = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(value);
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3])
    ? Math.floor(value / 86_400_000)
    : null;
}

function calendarMinute(value?: string): { date: string; minute: number } | null {
  const match = value?.trim().match(CALENDAR_DATE_TIME);
  if (!match || match[2] === undefined) return null;
  const ordinal = dateOrdinal(match[1]);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (ordinal === null || hours < 0 || hours > 23) return null;
  return { date: match[1], minute: ordinal * 24 * 60 + hours * 60 + minutes };
}

/**
 * Whole civil-minute duration between two calendar stamps. A reversed time
 * stored on the same date is treated as crossing midnight, without
 * DST-dependent math.
 */
export function calendarItemDurationMinutes(begin?: string, end?: string): number | null {
  const start = calendarMinute(begin);
  const finish = calendarMinute(end);
  if (!start || !finish) return null;
  let duration = finish.minute - start.minute;
  if (duration < 0 && start.date === finish.date) duration += 24 * 60;
  return duration >= 0 ? duration : null;
}

/** Compact duration label: `45m`, `2h`, or `1h 30m`. */
export function formatDurationShort(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return "";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

/** Drop redundant year/date parts from the end of a displayed range. */
export function formatEndDatePart(beginDate: string, endDate: string): string {
  if (!endDate || !beginDate || endDate === beginDate) return "";
  return beginDate.slice(0, 4) === endDate.slice(0, 4) ? endDate.slice(5) : endDate;
}

/** Canonical first-line time label shared by list-style clients. */
export function formatCalendarItemTimeRange(item: CalendarTimeItem, locale: Locale): string {
  const zh = locale === "zh";
  if (item.allDay) return zh ? "全天" : "All day";

  const beginMatch = item.begin?.trim().match(CALENDAR_DATE_TIME);
  const beginDate = beginMatch?.[1] ?? "";
  const beginTime = beginMatch?.[2] === undefined
    ? ""
    : `${beginMatch[2].padStart(2, "0")}:${beginMatch[3]}`;

  if (item.modality === "bill") return beginTime || (zh ? "账单" : "Bill");
  if (!beginTime) return zh ? "未定时间" : "Unscheduled";

  const endMatch = item.end?.trim().match(CALENDAR_DATE_TIME);
  const endDate = endMatch?.[1] ?? "";
  const endTime = endMatch?.[2] === undefined
    ? ""
    : `${endMatch[2].padStart(2, "0")}:${endMatch[3]}`;
  if (!endTime) return beginTime;

  const beginOrdinal = dateOrdinal(beginDate);
  const endOrdinal = dateOrdinal(endDate);
  const dayDifference = beginOrdinal === null || endOrdinal === null ? 0 : endOrdinal - beginOrdinal;
  const endLabel = dayDifference > 0
    ? `(+${dayDifference})${endTime}`
    : dayDifference === 0 && endTime < beginTime
      ? `(+1)${endTime}`
      : endTime;
  const duration = formatDurationShort(calendarItemDurationMinutes(item.begin, item.end));
  return `${beginTime}-${endLabel}${duration ? `(${duration})` : ""}`;
}

function trimZero(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** Human-scale absolute amount used by compact bill badges. */
export function formatExpense(amount: number): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "";
  const absolute = Math.abs(amount);
  if (absolute === 0) return "";
  if (absolute < 1_000) return trimZero(absolute.toFixed(1));
  if (absolute < 1_000_000) return `${trimZero((absolute / 1_000).toFixed(1))}K`;
  if (absolute < 1_000_000_000) return `${trimZero((absolute / 1_000_000).toFixed(1))}M`;
  return `${trimZero((absolute / 1_000_000_000).toFixed(1))}G`;
}

/** Currency-first bill label; expenses keep the sign after the symbol. */
export function formatBillLabel(amount: number, symbol: string, compact = true): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "";
  const absolute = Math.abs(amount);
  const magnitude = compact
    ? formatExpense(absolute) || "0"
    : Number.isInteger(absolute)
      ? String(absolute)
      : trimZero(absolute.toFixed(2));
  return `${symbol}${amount < 0 ? "-" : ""}${magnitude}`;
}

export function billTotals(
  entries: Array<{ kind?: string; modality?: string; amount?: number; category?: string }>,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const entry of entries) {
    if ((entry.kind ?? entry.modality) !== "bill" || typeof entry.amount !== "number" || !Number.isFinite(entry.amount)) continue;
    if (billDirectionForCategory(entry.category ?? "", settings) === "income") income += Math.abs(entry.amount);
    else expense += Math.abs(entry.amount);
  }
  return { income, expense };
}

/**
 * Total spending magnitude for one day's already-projected entries. Callers
 * pass the entries a view is actually showing, so recurring bills and
 * per-occurrence overrides are counted exactly once and filters apply.
 */
export function dayExpenseTotal(
  entries: Array<{ kind?: string; modality?: string; amount?: number; category?: string }>,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
): number {
  let expense = 0;
  for (const entry of entries) {
    if ((entry.kind ?? entry.modality) !== "bill") continue;
    if (typeof entry.amount !== "number" || !Number.isFinite(entry.amount)) continue;
    if (billDirectionForCategory(entry.category ?? "", settings) !== "expense") continue;
    expense += Math.abs(entry.amount);
  }
  return expense;
}

export function expenseIntensityPercent(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 10;
  const normalized = Math.min(1, Math.log10(amount + 1) / 4);
  return Math.round(10 + normalized * 20);
}

export function expenseBorderPercent(amount: number): number {
  return Math.min(55, expenseIntensityPercent(amount) + 18);
}
