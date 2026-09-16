import {
  addIsoDays,
  compareIsoDates,
  entriesByDateRange,
  isIsoDate,
  isoDateRange,
  parseClockMinutes
} from "./calendar";
import type { Entry, EntryStatus, Locale } from "./entry";
import {
  billDirectionForCategory,
  DEFAULT_CHRONOEON_SETTINGS,
  resolveEntryColor,
  signedBillAmount,
  type ChronoEonSettings
} from "./settings";

export interface StatsRange {
  start: string;
  end: string;
}

export type StatsPresetKey =
  | "7d"
  | "1m"
  | "3m"
  | "1y"
  | "this_week"
  | "this_month"
  | "this_year";

function isoOf(value: Date): string {
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function startOfWeekIso(value: string, weekStartsOn: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay();
  const back = (day - weekStartsOn + 7) % 7;
  return addIsoDays(value, -back);
}

/** Resolve one of the shared statistics presets against a reference day. */
export function statsPresetRange(
  key: StatsPresetKey,
  today = isoOf(new Date()),
  weekStartsOn = 1
): StatsRange {
  const [year, month] = today.split("-").map(Number);
  switch (key) {
    case "7d":
      return { start: addIsoDays(today, -6), end: today };
    case "1m":
      return { start: addIsoDays(today, -29), end: today };
    case "3m":
      return { start: addIsoDays(today, -89), end: today };
    case "1y":
      return { start: addIsoDays(today, -364), end: today };
    case "this_week": {
      const start = startOfWeekIso(today, weekStartsOn);
      return { start, end: addIsoDays(start, 6) };
    }
    case "this_month": {
      const start = `${today.slice(0, 7)}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      return { start, end: `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
    }
    case "this_year":
    default:
      return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
}

export function rangeDayCount(range: StatsRange): number {
  if (!isIsoDate(range.start) || !isIsoDate(range.end)) return 1;
  return Math.max(1, isoDateRange(range.start, range.end).length);
}

export interface RangeSpan {
  days: number;
  months: number;
  years: number;
}

/** Count the distinct days, months and years a range covers. */
export function rangeSpanMetrics(range: StatsRange): RangeSpan {
  if (!isIsoDate(range.start) || !isIsoDate(range.end)) return { days: 1, months: 1, years: 1 };
  const dates = isoDateRange(range.start, range.end);
  return {
    days: dates.length,
    months: new Set(dates.map((d) => d.slice(0, 7))).size,
    years: new Set(dates.map((d) => d.slice(0, 4))).size,
  };
}

/**
 * Materialize every entry visible inside a range, expanding recurring series
 * into per-day occurrences. Entries spanning several days are counted once, on
 * the first visible day, so totals never double count a cross-day block.
 */
export function entriesInRange(entries: Entry[], range: StatsRange): Entry[] {
  if (!isIsoDate(range.start) || !isIsoDate(range.end) || compareIsoDates(range.end, range.start) < 0) return [];
  const seen = new Set<string>();
  const result: Entry[] = [];
  for (const dayEntries of entriesByDateRange(entries, range.start, range.end).values()) {
    for (const entry of dayEntries) {
      const key = entry.recurrenceSourceId ? `${entry.recurrenceSourceId}:${entry.occurrenceDate}` : entry.id;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

/** Whole-minute duration of a scheduled entry, or 0 when it has no span. */
export function entryDurationMinutes(entry: Pick<Entry, "date" | "start" | "end" | "endDate" | "allDay">): number {
  if (entry.allDay || !entry.start || !entry.end) return 0;
  const start = parseClockMinutes(entry.start);
  const end = parseClockMinutes(entry.end);
  if (start === null || end === null) return 0;
  const endDate = entry.endDate && isIsoDate(entry.endDate) ? entry.endDate : entry.date;
  const dayOffset = isIsoDate(endDate) && isIsoDate(entry.date)
    ? isoDateRange(entry.date, endDate).length - 1
    : 0;
  let duration = dayOffset * 24 * 60 + end - start;
  if (duration < 0 && dayOffset === 0) duration += 24 * 60;
  return duration > 0 ? duration : 0;
}

/** Compact duration label: `45m`, `2h`, or `1h 30m`. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export interface BillSubCategoryStat {
  name: string;
  count: number;
  total: number;
  entries: Entry[];
}

export interface BillCategoryStat {
  id: string;
  name: string;
  color: string;
  count: number;
  /** Signed: positive is income, negative is expense. */
  total: number;
  entries: Entry[];
  sub: BillSubCategoryStat[];
}

export interface BillStats {
  income: number;
  expense: number;
  balance: number;
  count: number;
  entries: Entry[];
  incomeEntries: Entry[];
  expenseEntries: Entry[];
  categories: BillCategoryStat[];
  /** Largest absolute category total; the share-bar denominator. */
  maxCategoryAbs: number;
  dailyAverageExpense: number;
}

function billCategoryOf(entry: Entry, settings: ChronoEonSettings) {
  const raw = entry.category || "uncategorized";
  const [primary, sub] = raw.split("/");
  const known = settings.bill.categories.find((candidate) =>
    candidate.id.toLocaleLowerCase() === primary.toLocaleLowerCase()
    || candidate.name.toLocaleLowerCase() === primary.toLocaleLowerCase());
  return {
    id: known?.id ?? primary,
    name: known?.name ?? primary,
    color: known?.color ?? entry.color ?? resolveEntryColor(raw, "bill", settings),
    sub: sub || undefined
  };
}

export function aggregateBillStats(
  entries: Entry[],
  range: StatsRange,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS
): BillStats {
  const inRange = entriesInRange(entries, range).filter((entry) => entry.kind === "bill");
  let income = 0;
  let expense = 0;
  const incomeEntries: Entry[] = [];
  const expenseEntries: Entry[] = [];
  const categories = new Map<string, BillCategoryStat & { subMap: Map<string, BillSubCategoryStat> }>();

  for (const entry of inRange) {
    const amount = signedBillAmount(entry.amount, entry.category, settings);
    if (amount === undefined) continue;
    if (billDirectionForCategory(entry.category, settings) === "income") {
      income += amount;
      incomeEntries.push(entry);
    } else {
      expense += Math.abs(amount);
      expenseEntries.push(entry);
    }
    const info = billCategoryOf(entry, settings);
    const bucket = categories.get(info.id) ?? {
      id: info.id,
      name: info.name,
      color: info.color,
      count: 0,
      total: 0,
      entries: [],
      sub: [],
      subMap: new Map<string, BillSubCategoryStat>()
    };
    bucket.count += 1;
    bucket.total += amount;
    bucket.entries.push(entry);
    if (info.sub) {
      const sub = bucket.subMap.get(info.sub) ?? { name: info.sub, count: 0, total: 0, entries: [] };
      sub.count += 1;
      sub.total += amount;
      sub.entries.push(entry);
      bucket.subMap.set(info.sub, sub);
    }
    categories.set(info.id, bucket);
  }

  const categoryList: BillCategoryStat[] = [...categories.values()]
    .map(({ subMap, ...rest }) => ({
      ...rest,
      sub: [...subMap.values()].sort((left, right) => Math.abs(right.total) - Math.abs(left.total))
    }))
    .sort((left, right) => {
      const leftDirection = left.total >= 0 ? 0 : 1;
      const rightDirection = right.total >= 0 ? 0 : 1;
      return leftDirection - rightDirection || Math.abs(right.total) - Math.abs(left.total);
    });

  return {
    income,
    expense,
    balance: income - expense,
    count: inRange.length,
    entries: inRange,
    incomeEntries,
    expenseEntries,
    categories: categoryList,
    maxCategoryAbs: categoryList.reduce((max, category) => Math.max(max, Math.abs(category.total)), 0),
    dailyAverageExpense: expense / rangeDayCount(range)
  };
}

export interface TaskCategoryStat {
  id: string;
  name: string;
  color: string;
  count: number;
  totalMinutes: number;
  longestMinutes: number;
}

export interface TaskStats {
  total: number;
  open: number;
  done: number;
  inProgress: number;
  cancelled: number;
  /** Completion percentage, 0–100. */
  rate: number;
  totalMinutes: number;
  longestMinutes: number;
  timedCount: number;
  categories: TaskCategoryStat[];
  entries: Entry[];
  periodDays: number;
}

function taskStatusOf(entry: Entry): EntryStatus {
  return entry.status ?? "open";
}

export function aggregateTaskStats(
  entries: Entry[],
  range: StatsRange,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
  locale: Locale = "en"
): TaskStats {
  const inRange = entriesInRange(entries, range);
  const tasks = inRange.filter((entry) => entry.kind === "task");
  const events = inRange.filter((entry) => entry.kind === "event");
  const scheduled = [...tasks, ...events];

  const categories = new Map<string, TaskCategoryStat>();
  let totalMinutes = 0;
  let longestMinutes = 0;
  let timedCount = 0;

  for (const entry of scheduled) {
    const minutes = entryDurationMinutes(entry);
    if (minutes <= 0) continue;
    timedCount += 1;
    totalMinutes += minutes;
    longestMinutes = Math.max(longestMinutes, minutes);
    const id = entry.category || "uncategorized";
    const calendarCategory = settings.calendars
      .flatMap((calendar) => calendar.categories)
      .find((candidate) => candidate.id === id || candidate.name === id);
    const bucket = categories.get(id) ?? {
      id,
      name: calendarCategory?.name ?? (locale === "zh" ? id : id),
      color: calendarCategory?.color ?? entry.color ?? resolveEntryColor(id, entry.kind, settings, entry.calendar),
      count: 0,
      totalMinutes: 0,
      longestMinutes: 0
    };
    bucket.count += 1;
    bucket.totalMinutes += minutes;
    bucket.longestMinutes = Math.max(bucket.longestMinutes, minutes);
    categories.set(id, bucket);
  }

  const done = tasks.filter((entry) => taskStatusOf(entry) === "done").length;
  const cancelled = tasks.filter((entry) => taskStatusOf(entry) === "cancelled").length;
  const inProgress = tasks.filter((entry) => taskStatusOf(entry) === "in-progress").length;

  return {
    total: tasks.length,
    open: tasks.length - done - cancelled - inProgress,
    done,
    inProgress,
    cancelled,
    rate: tasks.length > 0 ? (done / tasks.length) * 100 : 0,
    totalMinutes,
    longestMinutes,
    timedCount,
    categories: [...categories.values()].sort((left, right) => right.totalMinutes - left.totalMinutes),
    entries: scheduled,
    periodDays: rangeDayCount(range)
  };
}

export interface HeatmapDay {
  date: string;
  total: number;
  inYear: boolean;
  /** 0–4 shading bucket. */
  level: number;
}

export interface ExpenseHeatmap {
  year: number;
  weeks: HeatmapDay[][];
  monthLabels: Array<{ week: number; month: number }>;
  maxDay: number;
  total: number;
}

function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** GitHub-style yearly expense heatmap: one shaded cell per civil day. */
export function expenseHeatmap(
  entries: Entry[],
  year: number,
  weekStartsOn = 1,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
): ExpenseHeatmap {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const totals = new Map<string, number>();
  for (const entry of entriesInRange(entries, { start: yearStart, end: yearEnd })) {
    if (entry.kind !== "bill") continue;
    const amount = typeof entry.amount === "number" ? entry.amount : 0;
    if (billDirectionForCategory(entry.category, settings) !== "expense") continue;
    totals.set(entry.date, (totals.get(entry.date) ?? 0) + Math.abs(amount));
  }

  const gridStart = startOfWeekIso(yearStart, weekStartsOn);
  const gridEnd = addIsoDays(startOfWeekIso(yearEnd, weekStartsOn), 6);
  const days: HeatmapDay[] = isoDateRange(gridStart, gridEnd).map((date) => ({
    date,
    total: totals.get(date) ?? 0,
    inYear: date >= yearStart && date <= yearEnd,
    level: 0
  }));

  const maxDay = days.reduce((max, day) => (day.inYear ? Math.max(max, day.total) : max), 0);
  for (const day of days) day.level = day.inYear ? heatLevel(day.total, maxDay) : 0;

  const weeks: HeatmapDay[][] = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));

  const monthLabels: Array<{ week: number; month: number }> = [];
  let lastMonth = -1;
  weeks.forEach((week, index) => {
    const month = Number(week[0].date.slice(5, 7)) - 1;
    if (month !== lastMonth && week[0].inYear) {
      monthLabels.push({ week: index, month });
      lastMonth = month;
    }
  });

  return {
    year,
    weeks,
    monthLabels,
    maxDay,
    total: days.reduce((sum, day) => sum + (day.inYear ? day.total : 0), 0)
  };
}

export interface KeywordStats {
  query: string;
  isTag: boolean;
  entries: Entry[];
  income: number;
  expense: number;
  net: number;
  averageAmount: number;
  billCount: number;
  totalMinutes: number;
  averageMinutes: number;
  longestMinutes: number;
  timedCount: number;
  statusCount: Record<EntryStatus, number>;
}

/**
 * Free-text or `#tag` analytics over a range. Text search covers the fields a
 * user can actually see: title, category, payment method, location and tags.
 */
export function keywordStats(
  entries: Entry[],
  range: StatsRange,
  query: string,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
): KeywordStats {
  const trimmed = query.trim();
  const isTag = trimmed.startsWith("#");
  const needle = (isTag ? trimmed.slice(1) : trimmed).toLocaleLowerCase();
  const pool = entriesInRange(entries, range);
  const matches = !needle
    ? []
    : pool.filter((entry) => {
      const tags = entry.tags ?? [];
      if (isTag) return tags.some((tag) => tag.toLocaleLowerCase().replace(/^#/, "") === needle);
      return [entry.title, entry.titleZh, entry.category, entry.payment, entry.location, entry.note, ...tags]
        .filter(Boolean)
        .some((field) => String(field).toLocaleLowerCase().includes(needle));
    });

  let income = 0;
  let expense = 0;
  let billCount = 0;
  let totalMinutes = 0;
  let longestMinutes = 0;
  let timedCount = 0;
  const statusCount: Record<EntryStatus, number> = { open: 0, "in-progress": 0, done: 0, cancelled: 0 };

  for (const entry of matches) {
    if (entry.kind === "bill" && typeof entry.amount === "number") {
      billCount += 1;
      if (billDirectionForCategory(entry.category, settings) === "income") income += Math.abs(entry.amount);
      else expense += Math.abs(entry.amount);
    }
    const minutes = entryDurationMinutes(entry);
    if (minutes > 0) {
      timedCount += 1;
      totalMinutes += minutes;
      longestMinutes = Math.max(longestMinutes, minutes);
    }
    if (entry.kind === "task") statusCount[taskStatusOf(entry)] += 1;
  }

  return {
    query: trimmed,
    isTag,
    entries: matches,
    income,
    expense,
    net: income - expense,
    averageAmount: billCount ? (income - expense) / billCount : 0,
    billCount,
    totalMinutes,
    averageMinutes: timedCount ? totalMinutes / timedCount : 0,
    longestMinutes,
    timedCount,
    statusCount
  };
}

/** Distinct tags across the vault, most used first — powers tag suggestions. */
export function collectTags(entries: Entry[], limit = 24): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const raw of entry.tags ?? []) {
      const tag = raw.replace(/^#/, "").trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
    .slice(0, limit);
}
