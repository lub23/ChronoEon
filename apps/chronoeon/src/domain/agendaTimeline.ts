import { addDays, format, startOfWeek } from "date-fns";
import { dayExpenseTotal, entriesForDate, type ChronoEonSettings, type Entry, type EntryKind, type Locale } from "@chronoeon/domain";
import { entryMatchesSearch } from "./search";

/**
 * Item-kind selection shared by every view filter and the mini-window dock.
 * Kinds are independent toggles, not mutually exclusive: `["task", "bill"]`
 * shows tasks and bills together, and the empty array means "everything".
 */
export type AgendaFilter = EntryKind[];

export function kindAllowed(filter: AgendaFilter, kind: EntryKind): boolean {
  return filter.length === 0 || filter.includes(kind);
}

export interface TimelineDay {
  date: Date;
  key: string;
  /** Entries that survived the kind filter and the search, in display order. */
  entries: Entry[];
  /** Spending for the whole day, independent of the active kind filter. */
  expense: number;
  selected: boolean;
}

export type TimelineItem =
  | { type: "week"; key: string; start: Date }
  | { type: "day"; key: string; day: TimelineDay };

export interface TimelineOptions {
  entries: Entry[];
  /** Civil dates to consider, ascending. */
  dayKeys: string[];
  selectedKey: string;
  filter: AgendaFilter;
  search: string;
  locale: Locale;
  settings?: ChronoEonSettings;
  /**
   * Keep every requested day even when nothing matches. The Day-view timeline
   * wants a row per column; the twelve-week List view would otherwise render
   * eighty empty cards.
   */
  includeEmptyDays: boolean;
  /**
   * Show a cross-day entry only on its start date. List uses this so a week-long
   * holiday is one card; the Day timeline shows continuations like the grid does.
   */
  startDateOnly: boolean;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

const KIND_RANK: Record<string, number> = { task: 0, event: 1, idea: 2, bill: 3 };

/**
 * Coarse band, not a full order. A day reads "what has no clock" first, then
 * "what is on the clock", then "what it cost" — the same three bands the Day
 * grid draws (all-day lane, time grid, expense box).
 */
function entryBand(entry: Entry): number {
  if (entry.kind === "bill") return 2;
  return entry.allDay || !entry.start ? 0 : 1;
}

/**
 * Order inside a day.
 *
 * This used to rank kind and priority ABOVE the clock, which made the app's one
 * chronological surface non-chronological: on 2026-08-14 the List view rendered
 * 08:00, 11:00, 14:00, 09:00, 10:00, 12:00 — every task first, then every
 * event — while the Day grid placed the same six entries strictly by time. Two
 * views of one day cannot disagree about what "next" means, so time now wins
 * inside the timed band and priority/kind are only tie-breakers for entries
 * that start at the same minute (or have no clock at all).
 */
export function compareTimelineEntries(left: Entry, right: Entry): number {
  return entryBand(left) - entryBand(right)
    || (left.start ?? "00:00").localeCompare(right.start ?? "00:00")
    || (PRIORITY_RANK[left.priority ?? "normal"] ?? 1) - (PRIORITY_RANK[right.priority ?? "normal"] ?? 1)
    || (KIND_RANK[left.kind] ?? 9) - (KIND_RANK[right.kind] ?? 9)
    || left.id.localeCompare(right.id);
}

/** Inclusive list of `yyyy-MM-dd` keys, the input every timeline consumer builds. */
export function timelineDayKeys(start: Date, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => format(addDays(start, index), "yyyy-MM-dd"));
}

/**
 * The one projection behind every chronological surface: List, the Day-view
 * timeline layout and the mini window. Given civil dates it returns the visible
 * entries per day in display order plus that day's untouched expense total.
 */
export function buildTimelineDays(options: TimelineOptions): TimelineDay[] {
  const { entries, dayKeys, selectedKey, filter, search, locale, settings, includeEmptyDays, startDateOnly } = options;
  const output: TimelineDay[] = [];
  for (const key of dayKeys) {
    const projected = entriesForDate(entries, key);
    const scoped = startDateOnly ? projected.filter((entry) => entry.date === key) : projected;
    const visible = scoped
      .filter((entry) => kindAllowed(filter, entry.kind))
      .filter((entry) => entryMatchesSearch(entry, search, locale))
      .sort(compareTimelineEntries);
    const expense = dayExpenseTotal(projected, settings);
    const selected = key === selectedKey;
    if (includeEmptyDays || selected || visible.length || expense > 0) {
      output.push({ date: new Date(`${key}T00:00:00`), key, entries: visible, expense, selected });
    }
  }
  return output;
}

/**
 * Flatten days into one list of week headers plus day cards. A single flat array
 * is what virtualization needs — nested week sections cannot be measured row by
 * row — and it gives every rendered row a stable key.
 */
export function groupTimelineItems(days: TimelineDay[], weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6): TimelineItem[] {
  const output: TimelineItem[] = [];
  let currentWeek = "";
  for (const day of days) {
    const start = startOfWeek(day.date, { weekStartsOn });
    const weekKey = format(start, "yyyy-MM-dd");
    if (weekKey !== currentWeek) {
      currentWeek = weekKey;
      output.push({ type: "week", key: `week:${weekKey}`, start });
    }
    output.push({ type: "day", key: `day:${day.key}`, day });
  }
  return output;
}
