import {
  addIsoDays,
  compareIsoDates,
  entriesByDateRange,
  isIsoDate,
  isoDateRange,
  projectEntryOccurrence,
  recurrenceOccurrenceDates,
} from "./calendar";
import type { Entry } from "./entry";
import { DEFAULT_CHRONOEON_SETTINGS, resolveEntryColor, scheduleCategoryOptions, signedBillAmount, type ChronoEonSettings, type EntryCategoryOption } from "./settings";
import {
  aggregateBillStats,
  entriesInRange,
  entryDurationMinutes,
  rangeDayCount,
  rangeSpanMetrics,
  type BillStats,
  type StatsRange,
} from "./stats";

export type ReviewGranularity = "day" | "week" | "month" | "year";

/** Weekly curves require fourteen selected civil days, not just crossing a
 * week boundary. Coarser choices need at least two calendar buckets. */
export function reviewGranularities(range: StatsRange): ReviewGranularity[] {
  const span = rangeSpanMetrics(range);
  const options: ReviewGranularity[] = ["day"];
  if (span.days >= 14) options.push("week");
  if (span.months >= 2) options.push("month");
  if (span.years >= 2) options.push("year");
  return options;
}

export interface ReviewDelta {
  current: number;
  previous: number;
  /** `current - previous`; the sign is what the UI colours. */
  delta: number;
}

export interface ReviewBucket {
  /** ISO date of the bucket's first day (for click-to-open). */
  date: string;
  /** Total expense (sum of absolute negative amounts) in the bucket. */
  expense: number;
  /** Number of task entries in the bucket. */
  taskTotal: number;
  /** Number of done tasks in the bucket. */
  taskDone: number;
  /** Signed income/expense, so Total is the sum of all bill categories. */
  billTotal: number;
  /** Total income (sum of absolute positive amounts) in the bucket. */
  billIncome: number;
  billCategories: Record<string, number>;
  /** Daily schedule load includes both tasks and events. */
  scheduleTotal: number;
  scheduleCategories: Record<string, number>;
}

export interface ReviewSummary {
  range: StatsRange;
  previousRange: StatsRange;
  /** Every entry visible in the range, recurrences expanded, counted once. */
  total: number;
  tasks: {
    total: number;
    done: number;
    open: number;
    cancelled: number;
    /** Completion percentage, 0-100. */
    rate: ReviewDelta;
  };
  trackedMinutes: ReviewDelta;
  bills: BillStats;
  expense: ReviewDelta;
  /** Consecutive days ending at the range end that completed at least one task. */
  streak: number;
  /** Longest completion streak inside the range. */
  bestStreak: number;
  /** Non-recurring tasks in the range whose date is on or before today and are still open. */
  carriedOver: Entry[];
  /** Tasks completed inside the range, most recent first. */
  highlights: Entry[];
}

export interface OutstandingTaskSections {
  /** Unfinished tasks whose own date is before today, plus one recent missed occurrence per recurring series. */
  overdue: Entry[];
  /** Unfinished tasks dated today or later, plus one next occurrence per recurring series. */
  upcoming: Entry[];
}

const RECURRENCE_LOOKBACK_DAYS = 366;
const RECURRENCE_LOOKAHEAD_DAYS = 366;

function unfinishedTask(entry: Entry): boolean {
  return entry.kind === "task" && entry.status !== "done" && entry.status !== "cancelled";
}

function boundedDate(value: string | undefined, fallback: string, direction: "min" | "max"): string {
  if (!value || !isIsoDate(value)) return fallback;
  const compare = compareIsoDates(value, fallback);
  return direction === "min" ? (compare < 0 ? fallback : value) : (compare > 0 ? fallback : value);
}

/**
 * Split unfinished work into overdue and today/upcoming sections without
 * expanding a recurring series into one row per occurrence. A recurring series
 * contributes at most one recent missed occurrence and one next occurrence.
 */
export function outstandingTaskSections(
  entries: Entry[],
  today: string,
  range?: StatsRange,
): OutstandingTaskSections {
  if (!isIsoDate(today)) return { overdue: [], upcoming: [] };
  const yesterday = addIsoDays(today, -1);
  const rangeStart = range && isIsoDate(range.start) ? range.start : undefined;
  const rangeEnd = range && isIsoDate(range.end) ? range.end : undefined;
  const overdue: Entry[] = [];
  const upcoming: Entry[] = [];

  for (const entry of entries) {
    if (!unfinishedTask(entry) || !isIsoDate(entry.date)) continue;
    if (!entry.recurrence || entry.recurrence === "none") {
      if (compareIsoDates(entry.date, today) < 0) {
        if ((!rangeStart || compareIsoDates(entry.date, rangeStart) >= 0)
          && (!rangeEnd || compareIsoDates(entry.date, rangeEnd) <= 0)) overdue.push(entry);
      } else if ((!rangeStart || compareIsoDates(entry.date, rangeStart) >= 0)
        && (!rangeEnd || compareIsoDates(entry.date, rangeEnd) <= 0)) {
        upcoming.push(entry);
      }
      continue;
    }

    const overdueStart = boundedDate(
      rangeStart,
      addIsoDays(today, -RECURRENCE_LOOKBACK_DAYS),
      "min",
    );
    const overdueEnd = boundedDate(
      rangeEnd,
      yesterday,
      "max",
    );
    const overdueDates = compareIsoDates(overdueStart, overdueEnd) <= 0
      ? recurrenceOccurrenceDates(entry, overdueStart, overdueEnd)
        .filter((date) => unfinishedTask(projectEntryOccurrence(entry, date)))
      : [];
    if (overdueDates.length) {
      overdue.push(projectEntryOccurrence(entry, overdueDates.at(-1)!));
    }

    const upcomingStart = boundedDate(rangeStart, today, "min");
    const upcomingEnd = boundedDate(
      rangeEnd,
      addIsoDays(today, RECURRENCE_LOOKAHEAD_DAYS),
      "max",
    );
    const upcomingDates = compareIsoDates(upcomingStart, upcomingEnd) <= 0
      ? recurrenceOccurrenceDates(entry, upcomingStart, upcomingEnd)
        .filter((date) => unfinishedTask(projectEntryOccurrence(entry, date)))
      : [];
    if (upcomingDates.length) {
      upcoming.push(projectEntryOccurrence(entry, upcomingDates[0]));
    }
  }

  overdue.sort((left, right) => compareIsoDates(right.date, left.date) || left.title.localeCompare(right.title));
  upcoming.sort((left, right) => compareIsoDates(left.date, right.date) || left.title.localeCompare(right.title));
  return { overdue, upcoming };
}

/** Previous range of the same length, immediately before `range`. */
export function previousRangeOf(range: StatsRange): StatsRange {
  const days = rangeDayCount(range);
  return { start: addIsoDays(range.start, -days), end: addIsoDays(range.start, -1) };
}

/**
 * Tasks that were due by `today` and still have not been completed. When a
 * review range is supplied, both ends are scoped to that range and the upper
 * bound is clamped to today so future work is never called overdue.
 */
export function outstandingTasks(entries: Entry[], today: string, range?: StatsRange): Entry[] {
  if (!isIsoDate(today)) return [];
  const lower = range && isIsoDate(range.start) ? range.start : null;
  const upper = range && isIsoDate(range.end) && compareIsoDates(range.end, today) < 0
    ? range.end
    : today;
  return entries
    .filter((entry) => entry.kind === "task"
      && (!entry.recurrence || entry.recurrence === "none")
      && entry.status !== "done"
      && entry.status !== "cancelled"
      && isIsoDate(entry.date)
      && compareIsoDates(entry.date, upper) <= 0
      && (!lower || compareIsoDates(entry.date, lower) >= 0))
    .sort((left, right) => compareIsoDates(right.date, left.date) || left.title.localeCompare(right.title));
}

const primaryCategory = (value: string | undefined) => value?.split("/")[0]?.trim() || "uncategorized";

/** One entry per first-level category; IDs and display-name storage resolve to
 * the same catalog key. Categories with no data remain selectable at zero. */
export function reviewCategoryOptions(
  entries: Entry[],
  kind: "bill" | "schedule",
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
): EntryCategoryOption[] {
  const scoped = entries.filter(entry => kind === "bill" ? entry.kind === "bill" : entry.kind === "task" || entry.kind === "event");
  const options: EntryCategoryOption[] = kind === "bill"
    ? settings.bill.categories.map(category => ({ value: category.id, label: category.name, color: category.color }))
    : scheduleCategoryOptions(settings).map(({ value, label, color }) => ({ value, label, color }));
  const aliases = new Set(options.flatMap(option => [option.value.toLocaleLowerCase(), option.label.toLocaleLowerCase()]));
  for (const entry of scoped) {
    const value = primaryCategory(entry.category);
    if (aliases.has(value.toLocaleLowerCase())) continue;
    aliases.add(value.toLocaleLowerCase());
    options.push({ value, label: value, color: entry.color ?? resolveEntryColor(value, entry.kind, settings, entry.calendar) });
  }
  return options;
}

function categoryAliases(options: EntryCategoryOption[]): Map<string, string> {
  return new Map(options.flatMap(option => [[option.value.toLocaleLowerCase(), option.value], [option.label.toLocaleLowerCase(), option.value]]));
}

/** Aggregate every curve in one date projection; switching selected series does
 * not re-expand recurrence or rerun a calendar per category. */
export function reviewBuckets(
  entries: Entry[],
  range: StatsRange,
  granularity: ReviewGranularity,
  settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS,
): ReviewBucket[] {
  if (!isIsoDate(range.start) || !isIsoDate(range.end)) return [];
  const dates = isoDateRange(range.start, range.end);
  const byDate = entriesByDateRange(entries, range.start, range.end);
  const bills = categoryAliases(reviewCategoryOptions(entries, "bill", settings));
  const schedules = categoryAliases(reviewCategoryOptions(entries, "schedule", settings));
  const groups = new Map<string, ReviewBucket>();
  for (const date of dates) {
    const key = granularity === "year" ? date.slice(0, 4) + "-01-01"
      : granularity === "month" ? date.slice(0, 7) + "-01"
      : granularity === "week" ? addIsoDays(date, -((new Date(date + "T00:00:00Z").getUTCDay() - settings.firstDay + 7) % 7))
      : date;
    let group = groups.get(key);
    if (!group) {
      group = { date: key, expense: 0, taskTotal: 0, taskDone: 0, billTotal: 0, billIncome: 0, scheduleTotal: 0,
        billCategories: Object.create(null) as Record<string, number>, scheduleCategories: Object.create(null) as Record<string, number> };
      groups.set(key, group);
    }
    for (const entry of byDate.get(date) ?? []) {
      const primary = primaryCategory(entry.category);
      if (entry.kind === "bill") {
        const amount = signedBillAmount(entry.amount, entry.category, settings) ?? 0;
        const category = bills.get(primary.toLocaleLowerCase()) ?? primary;
        group.billTotal += amount;
        if (amount < 0) group.expense -= amount;
        if (amount > 0) group.billIncome += amount;
        group.billCategories[category] = (group.billCategories[category] ?? 0) + amount;
      } else if (entry.kind === "task" || entry.kind === "event") {
        const category = schedules.get(primary.toLocaleLowerCase()) ?? primary;
        group.scheduleTotal += 1;
        group.scheduleCategories[category] = (group.scheduleCategories[category] ?? 0) + 1;
        if (entry.kind === "task") {
          group.taskTotal += 1;
          if (entry.status === "done") group.taskDone += 1;
        }
      }
    }
  }
  return [...groups.values()];
}

function delta(current: number, previous: number): ReviewDelta {
  return { current, previous, delta: current - previous };
}

function completionRate(entries: Entry[]): { total: number; done: number; open: number; cancelled: number; rate: number } {
  const tasks = entries.filter((entry) => entry.kind === "task");
  const done = tasks.filter((entry) => entry.status === "done").length;
  const cancelled = tasks.filter((entry) => entry.status === "cancelled").length;
  // Cancelled work is neither a success nor a failure, so it leaves the ratio.
  const considered = tasks.length - cancelled;
  return {
    total: tasks.length,
    done,
    open: tasks.length - done - cancelled,
    cancelled,
    rate: considered > 0 ? (done / considered) * 100 : 0,
  };
}

function trackedMinutes(entries: Entry[]): number {
  return entries.reduce((sum, entry) => sum + entryDurationMinutes(entry), 0);
}

/**
 * A period retrospective: what got done, what it cost, when the load fell, and
 * what is still waiting. Every number is derived from the entries themselves —
 * nothing is stored — so a review is always consistent with the database.
 */
export function buildReview(
  entries: Entry[],
  range: StatsRange,
  settings: ChronoEonSettings,
  today: string,
): ReviewSummary {
  const previousRange = previousRangeOf(range);
  const inRange = entriesInRange(entries, range);
  const inPrevious = entriesInRange(entries, previousRange);

  const current = completionRate(inRange);
  const previous = completionRate(inPrevious);
  const bills = aggregateBillStats(entries, range, settings);
  const previousBills = aggregateBillStats(entries, previousRange, settings);

  const dates = isIsoDate(range.start) && isIsoDate(range.end) ? isoDateRange(range.start, range.end) : [];
  const byDate = entriesByDateRange(entries, range.start, range.end);
  const days: { date: string; total: number; done: number }[] = dates.map((date) => {
    const forDate = byDate.get(date) ?? [];
    return {
      date,
      total: forDate.length,
      done: forDate.filter((entry) => entry.kind === "task" && entry.status === "done").length,
    };
  });

  let streak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index].done === 0) break;
    streak += 1;
  }
  let bestStreak = 0;
  let run = 0;
  for (const day of days) {
    run = day.done > 0 ? run + 1 : 0;
    if (run > bestStreak) bestStreak = run;
  }

  const carriedOver = outstandingTasks(entries, today, range);

  const highlights = inRange
    .filter((entry) => entry.kind === "task" && entry.status === "done")
    .sort((left, right) => compareIsoDates(right.date, left.date) || left.title.localeCompare(right.title));

  return {
    range,
    previousRange,
    total: inRange.length,
    tasks: {
      total: current.total,
      done: current.done,
      open: current.open,
      cancelled: current.cancelled,
      rate: delta(current.rate, previous.rate),
    },
    trackedMinutes: delta(trackedMinutes(inRange), trackedMinutes(inPrevious)),
    bills,
    expense: delta(bills.expense, previousBills.expense),
    streak,
    bestStreak,
    carriedOver,
    highlights,
  };
}
