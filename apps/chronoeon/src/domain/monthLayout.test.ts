import { describe, expect, it } from "vitest";
import type { Entry } from "./entry";
import { layoutMonthGrid, layoutSpanLane } from "./monthLayout";

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

const days = Array.from({ length: 7 }, (_, index) => `2026-08-${String(index + 3).padStart(2, "0")}`);

describe("calendar span layout", () => {
  it("draws one cross-day banner and reserves every covered column", () => {
    const trip = entry({ id: "trip", date: days[0], endDate: days[2], allDay: true });
    const meeting = entry({ id: "meeting", date: days[1], start: "09:00", end: "10:00" });
    const layout = layoutMonthGrid(days, (date) => [trip, meeting].filter((item) => item.date <= date && (item.endDate ?? item.date) >= date), { full: 4, withOverflow: 3 });

    expect(layout.banners).toHaveLength(1);
    expect(layout.banners[0]).toMatchObject({ startColumn: 0, span: 3, slot: 0 });
    expect(layout.cells.get(days[1])?.placements[0]).toMatchObject({ entry: meeting, slot: 1 });
  });

  it("lists only actually hidden items, including overlapping but not visible earlier banners", () => {
    const visible = entry({ id: "visible", date: "2026-08-01", endDate: days[4], allDay: true });
    const hidden = entry({ id: "hidden", date: days[1], endDate: days[2], allDay: true });
    const singles = Array.from({ length: 3 }, (_, index) => entry({ id: `single-${index}`, date: days[1] }));
    const items = [visible, hidden, ...singles];
    const layout = layoutMonthGrid(days, date => items.filter(item => item.date <= date && (item.endDate ?? item.date) >= date), { full: 2, withOverflow: 1 });
    const cell = layout.cells.get(days[1])!;
    expect(cell.hiddenEntries.map(item => item.id).sort()).toEqual(["hidden", "single-0", "single-1", "single-2"]);
    expect(cell.overflow).toBe(cell.hiddenEntries.length);
    expect(layout.cells.get(days[3])?.hiddenEntries).toEqual([]);
    expect(layout.cells.get(days[6])?.entries).toEqual([]);
  });

  it("folds inferred overnight spans into their starting day's overflow", () => {
    const overnight = entry({ id: "overnight", date: days[0], start: "23:30", end: "07:00" });
    const singles = Array.from({ length: 4 }, (_, index) => entry({ id: `single-${index}`, date: days[0] }));
    const layout = layoutMonthGrid(days, date => [overnight, ...singles].filter(item => item.date === date), { full: 0, withOverflow: 1 });
    const cell = layout.cells.get(days[0])!;
    expect(cell.hiddenEntries.map(item => item.id)).toContain("overnight");
    expect(layout.banners).toEqual([]);
  });

  it("keeps the expense box even when the active item filter hides bills", () => {
    const task = entry({ id: "task", kind: "task" });
    const bill = entry({ id: "bill", kind: "bill", amount: -42 });
    const layout = layoutMonthGrid(days, () => [task], { full: 3, withOverflow: 2 }, (date) => date === days[0] ? [task, bill] : []);

    expect(layout.cells.get(days[0])?.expense).toBe(42);
    expect(layout.cells.get(days[0])?.placements[0]?.slot).toBe(1);
  });

  it("reserves a dedicated expense row in Day/Week without shifting unrelated columns", () => {
    const first = entry({ id: "first", date: days[0], allDay: true });
    const spanning = entry({ id: "span", date: days[0], endDate: days[1], allDay: true });
    const lane = layoutSpanLane(
      days,
      (date) => [first, spanning].filter((item) => item.date <= date && (item.endDate ?? item.date) >= date),
      (date) => date === days[0] ? 1 : 0,
    );
    expect(lane.items.find((item) => item.entry.id === "span")?.row).toBeGreaterThanOrEqual(1);
    expect(lane.rowCount).toBeGreaterThanOrEqual(2);
  });

  it("clamps a span to the visible Day/Week lane without duplicating it", () => {
    const long = entry({ id: "long", date: "2026-08-01", endDate: "2026-08-12", allDay: true });
    const lane = layoutSpanLane(days, () => [long]);
    expect(lane.items).toHaveLength(1);
    expect(lane.items[0]).toMatchObject({ startColumn: 0, span: 7, continuesBefore: true, continuesAfter: true });
  });
});
