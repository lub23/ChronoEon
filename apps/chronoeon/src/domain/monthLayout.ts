import {
  addIsoDays,
  compareIsoDates,
  dayExpenseTotal,
  differenceInIsoDays,
  effectiveEntryEndDate,
  type ChronoEonSettings
} from "@chronoeon/domain";
import type { Entry } from "./entry";

/**
 * Month-grid slot layout.
 *
 * The month grid has to agree with itself in two directions at once: a
 * multi-day banner is drawn ONCE at grid level so it can cross cell borders,
 * while single-day chips are drawn inside their own cell. Both compete for the
 * same vertical slots, so slot assignment has to be computed for the whole
 * week row before either is rendered — otherwise a banner and a chip land on
 * top of each other, which is exactly what a per-cell layout cannot see.
 *
 * The per-day expense summary reserves slot 0 in the columns that have one, so
 * every cell's first chip starts at the same offset whether or not that day
 * had spending.
 */

export const MONTH_SLOT_PITCH = 19;
export const MONTH_SLOT_HEIGHT = 17;
export const MONTH_MORE_HEIGHT = 10;

export interface MonthSlotCapacity {
  full: number;
  withOverflow: number;
}

/** A short overflow strip can use leftover pixels instead of consuming a chip row. */
export function monthSlotCapacity(availableHeight: number): MonthSlotCapacity {
  return {
    full: Math.max(0, Math.floor((availableHeight + MONTH_SLOT_PITCH - MONTH_SLOT_HEIGHT) / MONTH_SLOT_PITCH)),
    withOverflow: Math.max(0, Math.floor((availableHeight - MONTH_MORE_HEIGHT) / MONTH_SLOT_PITCH)),
  };
}

export interface MonthBanner {
  key: string;
  entry: Entry;
  /** Week row, 0-5. */
  row: number;
  /** First visible grid column in this row, 0-6. */
  startColumn: number;
  /** Number of columns covered in this row. */
  span: number;
  /** Vertical slot inside the cell. */
  slot: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface MonthCellPlacement {
  entry: Entry;
  slot: number;
}

export interface MonthCell {
  date: string;
  entries: Entry[];
  hiddenEntries: Entry[];
  placements: MonthCellPlacement[];
  expense: number;
  /** Items that did not fit in the visible slots. */
  overflow: number;
}

export interface MonthGridLayout {
  cells: Map<string, MonthCell>;
  banners: MonthBanner[];
}

interface SpanEntry {
  entry: Entry;
  start: string;
  end: string;
}

function entrySpan(entry: Entry): SpanEntry {
  const end = effectiveEntryEndDate(entry);
  return { entry, start: entry.date, end };
}

const KIND_ORDER: Record<Entry["kind"], number> = { event: 0, task: 1, idea: 2, bill: 3 };

function compareEntries(left: Entry, right: Entry): number {
  const allDay = Number(Boolean(right.allDay || !right.start)) - Number(Boolean(left.allDay || !left.start));
  if (allDay) return allDay;
  const start = (left.start ?? "").localeCompare(right.start ?? "");
  if (start) return start;
  const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  if (kind) return kind;
  return left.id.localeCompare(right.id);
}

/** Lowest slot free across every column the item covers. */
function claimSlot(occupancy: Array<Set<number>>, startColumn: number, span: number): number {
  let slot = 0;
  for (;;) {
    let free = true;
    for (let column = startColumn; column < startColumn + span; column += 1) {
      if (occupancy[column]?.has(slot)) { free = false; break; }
    }
    if (free) {
      for (let column = startColumn; column < startColumn + span; column += 1) occupancy[column]?.add(slot);
      return slot;
    }
    slot += 1;
    if (slot > 64) return slot; // pathological data guard; the cell will report overflow
  }
}

/**
 * Lay out one month grid. `days` must be the 42 ISO dates already on screen and
 * `entriesFor` must return the entries a view is really showing for a date
 * (recurrence projected, filters and search applied).
 */
export function layoutMonthGrid(
  days: string[],
  entriesFor: (date: string) => Entry[],
  capacity: MonthSlotCapacity,
  /** Expense summaries are independent metadata and may intentionally ignore the item filter. */
  expenseEntriesFor: (date: string) => Entry[] = entriesFor,
  settings?: ChronoEonSettings,
): MonthGridLayout {
  const cells = new Map<string, MonthCell>();
  const banners: MonthBanner[] = [];
  const byDate = new Map<string, Entry[]>();

  for (const date of days) {
    const entries = [...entriesFor(date)].sort(compareEntries);
    byDate.set(date, entries);
  }

  for (let row = 0; row * 7 < days.length; row += 1) {
    const rowDays = days.slice(row * 7, row * 7 + 7);
    if (!rowDays.length) break;
    const occupancy: Array<Set<number>> = rowDays.map(() => new Set<number>());
    const rowStart = rowDays[0];
    const rowEnd = rowDays[rowDays.length - 1];

    // 1) Reserve slot 0 wherever the day carries a spending summary.
    const expenses = rowDays.map((date) => dayExpenseTotal(expenseEntriesFor(date), settings));
    expenses.forEach((expense, column) => { if (expense > 0) occupancy[column].add(0); });

    // 2) Multi-day banners, longest first so the widest bars sit highest.
    const rowBanners: MonthBanner[] = [];
    const seen = new Set<string>();
    const spans: SpanEntry[] = [];
    rowDays.forEach((date) => {
      for (const entry of byDate.get(date) ?? []) {
        const span = entrySpan(entry);
        if (span.end === span.start) continue;
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        spans.push(span);
      }
    });
    spans.sort((left, right) => {
      const length = differenceInIsoDays(right.end, right.start) - differenceInIsoDays(left.end, left.start);
      if (length) return length;
      return compareEntries(left.entry, right.entry);
    });

    for (const span of spans) {
      if (compareIsoDates(span.end, rowStart) < 0 || compareIsoDates(span.start, rowEnd) > 0) continue;
      const visibleStart = compareIsoDates(span.start, rowStart) < 0 ? rowStart : span.start;
      const visibleEnd = compareIsoDates(span.end, rowEnd) > 0 ? rowEnd : span.end;
      const startColumn = differenceInIsoDays(visibleStart, rowStart);
      const columns = differenceInIsoDays(visibleEnd, visibleStart) + 1;
      if (startColumn < 0 || columns <= 0) continue;
      const slot = claimSlot(occupancy, startColumn, columns);
      rowBanners.push({
        key: `${span.entry.id}:${rowStart}`,
        entry: span.entry,
        row,
        startColumn,
        span: columns,
        slot,
        continuesBefore: compareIsoDates(span.start, rowStart) < 0,
        continuesAfter: compareIsoDates(span.end, rowEnd) > 0,
      });
    }

    // 3) Pack singles after banners, then determine which cells need the short
    // overflow strip. Hiding a banner must apply to its entire visible span.
    const singles = rowDays.map((date, column) => (byDate.get(date) ?? [])
      .filter((entry) => { const span = entrySpan(entry); return span.end === span.start; })
      .map((entry) => ({ entry, slot: claimSlot(occupancy, column, 1) })));
    const limits = rowDays.map(() => capacity.full);
    const covers = (banner: MonthBanner, column: number) => column >= banner.startColumn && column < banner.startColumn + banner.span;
    let hidden = new Set<MonthBanner>();
    // Limits only decrease, at most once per column. Re-evaluate when hiding a
    // banner causes overflow in another covered cell; badges never cover it.
    let changed: boolean;
    do {
      hidden = new Set(rowBanners.filter((banner) => limits.some((limit, column) => covers(banner, column) && banner.slot >= limit)));
      changed = false;
      rowDays.forEach((_, column) => {
        const overflows = singles[column].some((placement) => placement.slot >= limits[column])
          || [...hidden].some((banner) => covers(banner, column));
        if (overflows && limits[column] > capacity.withOverflow) {
          limits[column] = capacity.withOverflow;
          changed = true;
        }
      });
    } while (changed);
    banners.push(...rowBanners.filter((banner) => !hidden.has(banner)));
    rowDays.forEach((date, column) => {
      const placements = singles[column].filter((placement) => placement.slot < limits[column]);
      const hiddenIds = new Set([
        ...singles[column].filter((placement) => placement.slot >= limits[column]).map(({ entry }) => entry.id),
        ...[...hidden].filter((banner) => covers(banner, column)).map(({ entry }) => entry.id),
      ]);
      const entries = byDate.get(date) ?? [];
      const hiddenEntries = entries.filter((entry) => hiddenIds.has(entry.id));
      cells.set(date, { date, entries, hiddenEntries, placements, expense: expenses[column], overflow: hiddenEntries.length });
    });
  }

  // Days outside the requested grid still deserve an (empty) cell record.
  for (const date of days) {
    if (!cells.has(date)) cells.set(date, { date, entries: byDate.get(date) ?? [], hiddenEntries: [], placements: [], expense: 0, overflow: 0 });
  }
  return { cells, banners };
}

/** The ISO dates covered by a month grid starting at `gridStart`. */
export function monthGridDates(gridStart: string, length = 42): string[] {
  return Array.from({ length }, (_, index) => addIsoDays(gridStart, index));
}

export interface LanePlacement {
  key: string;
  entry: Entry;
  startColumn: number;
  span: number;
  row: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Pack all-day and multi-day entries into the Day/Week parking lane. Unlike the
 * month grid this is a single row of N columns, so a three-day trip becomes one
 * bar spanning three columns rather than three disconnected chips.
 */
export function layoutSpanLane(
  days: string[],
  entriesFor: (date: string) => Entry[],
  /** Metadata rows (for example a per-day expense box) reserved per column. */
  reservedRowsFor: (date: string) => number = () => 0,
): { items: LanePlacement[]; rowCount: number } {
  if (!days.length) return { items: [], rowCount: 1 };
  const reservedRows = days.map((date) => Math.max(0, Math.floor(reservedRowsFor(date))));
  const occupancy: Array<Set<number>> = days.map((_, column) => {
    const slots = new Set<number>();
    for (let row = 0; row < reservedRows[column]; row += 1) slots.add(row);
    return slots;
  });
  const seen = new Set<string>();
  const spans: SpanEntry[] = [];

  for (const date of days) {
    for (const entry of [...entriesFor(date)].sort(compareEntries)) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      spans.push(entrySpan(entry));
    }
  }
  spans.sort((left, right) => {
    const length = differenceInIsoDays(right.end, right.start) - differenceInIsoDays(left.end, left.start);
    return length || compareEntries(left.entry, right.entry);
  });

  const first = days[0];
  const last = days[days.length - 1];
  const items: LanePlacement[] = [];
  for (const span of spans) {
    if (compareIsoDates(span.end, first) < 0 || compareIsoDates(span.start, last) > 0) continue;
    const visibleStart = compareIsoDates(span.start, first) < 0 ? first : span.start;
    const visibleEnd = compareIsoDates(span.end, last) > 0 ? last : span.end;
    const startColumn = differenceInIsoDays(visibleStart, first);
    const columns = differenceInIsoDays(visibleEnd, visibleStart) + 1;
    if (startColumn < 0 || columns <= 0) continue;
    items.push({
      key: `${span.entry.id}:${first}`,
      entry: span.entry,
      startColumn,
      span: columns,
      row: claimSlot(occupancy, startColumn, columns),
      continuesBefore: compareIsoDates(span.start, first) < 0,
      continuesAfter: compareIsoDates(span.end, last) > 0,
    });
  }
  return {
    items,
    rowCount: Math.max(1, ...reservedRows, ...items.map((item) => item.row + 1)),
  };
}
