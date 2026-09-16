import { addDays, format, startOfMonth, startOfWeek } from "date-fns";
import { describe, expect, it } from "vitest";
import type { Entry } from "./entry";
import { layoutMonthGrid, monthSlotCapacity } from "./monthLayout";

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: "entry",
    kind: "event",
    title: "Entry",
    date: "2026-08-03",
    category: "general",
    color: "#90d7ec",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const D = (day: number) => `2026-08-${String(day).padStart(2, "0")}`;
/** The 42-day grid of an August 2026 month view (Monday-first). */
const GRID = (() => {
  const gridStart = startOfWeek(startOfMonth(new Date(2026, 7, 1)), { weekStartsOn: 1 });
  return Array.from({ length: 42 }, (_, index) => format(addDays(gridStart, index), "yyyy-MM-dd"));
})();

function onDate(item: Entry, date: string): boolean {
  const end = item.endDate ?? item.date;
  return item.date <= date && end >= date;
}

describe("month layout: item placement", () => {
  it("never places two chips in the same slot of one cell", () => {
    const day = D(10);
    const entries = Array.from({ length: 6 }, (_, index) =>
      entry({ id: `t${index}`, date: day, start: `${String(8 + index).padStart(2, "0")}:00`, end: `${String(9 + index).padStart(2, "0")}:00`, allDay: false }),
    );
    const layout = layoutMonthGrid(GRID, (date) => entries.filter((item) => onDate(item, date)), { full: 4, withOverflow: 3 });
    const cell = layout.cells.get(day)!;
    const slots = cell.placements.map((placement) => placement.slot);
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots.every((slot) => slot < 4)).toBe(true);
    // Six chips into four rows: rows 0-2 hold chips, the fourth row is reserved
    // for the +N badge (so it never clips), and the chips that would have taken
    // rows 3, 4, 5 are all folded into the hidden count -> "+3".
    expect(cell.placements).toHaveLength(3);
    expect(cell.overflow).toBe(3);
  });

  it("keeps single-day chips clear of a multi-day banner in the same row", () => {
    const banner = entry({ id: "trip", date: D(10), endDate: D(12), allDay: true });
    const chips = Array.from({ length: 3 }, (_, index) =>
      entry({ id: `c${index}`, date: D(11), start: `${String(9 + index).padStart(2, "0")}:00`, allDay: false }),
    );
    const layout = layoutMonthGrid(GRID, (date) => [banner, ...chips].filter((item) => onDate(item, date)), { full: 4, withOverflow: 3 });
    const bannerRow = layout.banners.find((item) => item.entry.id === "trip")!;
    const cell = layout.cells.get(D(11))!;
    for (const placement of cell.placements) {
      expect(placement.slot).not.toBe(bannerRow.slot);
    }
  });

  it("splits a banner across week rows and keeps both segments clear of chips", () => {
    // 2026-08-08 (Sat) -> 2026-08-10 (Mon) crosses the Sunday row boundary (Monday-first grid).
    const banner = entry({ id: "trip", date: D(8), endDate: D(10), allDay: true });
    const chipBefore = entry({ id: "c1", date: D(9), allDay: true });
    const chipAfter = entry({ id: "c2", date: D(10), allDay: true });
    const layout = layoutMonthGrid(GRID, (date) => [banner, chipBefore, chipAfter].filter((item) => onDate(item, date)), { full: 4, withOverflow: 3 });
    const segments = layout.banners.filter((item) => item.entry.id === "trip");
    expect(segments).toHaveLength(2);
    const [first, second] = segments;
    expect(first.continuesAfter).toBe(true);
    expect(second.continuesBefore).toBe(true);
    expect(first.row).not.toBe(second.row);
    const beforeCell = layout.cells.get(D(9))!;
    const afterCell = layout.cells.get(D(10))!;
    // In both cells the banner segment claims slot 0; the all-day chip is pushed
    // to slot 1 (not the badge row), so it keeps its own row without overlapping
    // the banner or needing the +N badge.
    expect(beforeCell.placements[0]?.slot).not.toBe(first.slot);
    expect(afterCell.placements[0]?.slot).not.toBe(second.slot);
  });

  it("reserves slot 0 for the expense box so the first chip never overlaps it", () => {
    const day = D(10);
    const bill = entry({ id: "bill", kind: "bill", date: day, amount: -30, allDay: true });
    const task = entry({ id: "task", kind: "task", date: day, allDay: true });
    const layout = layoutMonthGrid(
      GRID,
      (date) => [bill, task].filter((item) => onDate(item, date)),
      { full: 4, withOverflow: 3 },
      (date) => [bill, task].filter((item) => onDate(item, date)),
    );
    const cell = layout.cells.get(day)!;
    expect(cell.expense).toBe(30);
    expect(cell.placements.find((placement) => placement.entry.id === "task")?.slot).toBe(1);
  });

  it("counts a hidden multi-day banner once per covered cell", () => {
    const banners = Array.from({ length: 5 }, (_, index) =>
      entry({ id: `b${index}`, date: D(10), endDate: D(12), allDay: true }),
    );
    const layout = layoutMonthGrid(GRID, (date) => banners.filter((item) => onDate(item, date)), { full: 4, withOverflow: 3 });
    // The last visible banner is also hidden to leave a collision-free strip.
    expect(layout.banners).toHaveLength(3);
    expect(layout.banners.every((banner) => banner.slot < 3)).toBe(true);
    expect(layout.cells.get(D(10))?.overflow).toBe(2);
    expect(layout.cells.get(D(11))?.overflow).toBe(2);
    expect(layout.cells.get(D(12))?.overflow).toBe(2);
    // Days outside the span stay clean.
    expect(layout.cells.get(D(13))?.overflow).toBe(0);
  });
});


describe("compact month overflow capacity", () => {
  it("uses leftover cell height for the short badge and restores items as height increases", () => {
    const items = Array.from({ length: 6 }, (_, index) => entry({ id: String(index), date: D(10) }));
    const entriesFor = (date: string) => items.filter(item => onDate(item, date));
    expect(monthSlotCapacity(76)).toEqual({ full: 4, withOverflow: 3 });
    expect(monthSlotCapacity(86)).toEqual({ full: 4, withOverflow: 4 });
    for (const height of [86, 76, 86]) {
      const capacity = monthSlotCapacity(height);
      const cell = layoutMonthGrid(GRID, entriesFor, capacity).cells.get(D(10))!;
      expect(cell.placements).toHaveLength(capacity.withOverflow);
      expect(cell.overflow).toBe(6 - capacity.withOverflow);
      expect(capacity.withOverflow * 19 + 10).toBeLessThanOrEqual(height);
    }
    expect(monthSlotCapacity(0)).toEqual({ full: 0, withOverflow: 0 });
  });
  it("does not reserve a badge row when all items fit", () => {
    const items = Array.from({ length: 4 }, (_, index) => entry({ id: String(index), date: D(10) }));
    const cell = layoutMonthGrid(GRID, date => items.filter(item => onDate(item, date)), monthSlotCapacity(76)).cells.get(D(10))!;
    expect(cell.placements).toHaveLength(4);
    expect(cell.overflow).toBe(0);
  });
  it("propagates hidden banner counts across covered cells without covering any banner with a badge", () => {
    const items = [entry({ id: "trip", date: D(10), endDate: D(12), allDay: true }), entry({ id: "bill", kind: "bill", date: D(10), amount: -30 })];
    const layout = layoutMonthGrid(GRID, date => items.filter(item => onDate(item, date)), { full: 2, withOverflow: 1 });
    expect(layout.banners).toHaveLength(0);
    expect(layout.cells.get(D(10))?.expense).toBe(30);
    expect(layout.cells.get(D(10))?.overflow).toBe(2);
    expect(layout.cells.get(D(11))?.overflow).toBe(1);
    expect(layout.cells.get(D(12))?.overflow).toBe(1);
    expect(layout.cells.get(D(13))?.overflow).toBe(0);
  });
});
