import { describe, expect, it } from "vitest";
import type { Entry } from "./entry";
import {
  addIsoDays,
  classifyCrossDayDateTimes,
  classifyCrossDayEntry,
  entriesForDate,
  entrySegmentForDate,
  formatEntryTime,
  getDailyFilePath,
  getDatesInWeek,
  isEntryPast,
  getWeeklyFilePath,
  isoDateRange,
  layoutOverlappingEntries,
  layoutTimedOverlaps,
  recurrenceOccurrenceDates,
  splitCrossDayDateTimeRange
} from "./calendar";

function entry(partial: Partial<Entry> & Pick<Entry, "id" | "date">): Entry {
  return {
    kind: "event",
    title: partial.id,
    category: "work",
    color: "#777",
    createdAt: `${partial.date}T00:00:00.000Z`,
    ...partial
  };
}

describe("shared calendar domain", () => {
  it("uses civil UTC dates across leap days and bounded ranges", () => {
    expect(addIsoDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addIsoDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(isoDateRange("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("projects weekly/monthly recurrence without creating invalid dates", () => {
    const weekly = entry({ id: "weekly", date: "2026-07-20", recurrence: "weekly", recurringDays: [1, 3], recurringEnd: "2026-08-03" });
    const monthly = entry({ id: "monthly", date: "2026-01-31", recurrence: "monthly" });
    expect(entriesForDate([weekly], "2026-07-29")).toHaveLength(1);
    expect(entriesForDate([weekly], "2026-07-30")).toHaveLength(0);
    expect(entriesForDate([weekly], "2026-08-05")).toHaveLength(0);
    expect(entriesForDate([monthly], "2026-02-28")).toHaveLength(0);
    expect(entriesForDate([monthly], "2026-03-31")).toHaveLength(1);
    expect(recurrenceOccurrenceDates(weekly, "2026-07-20", "2026-07-30")).toEqual([
      "2026-07-20", "2026-07-22", "2026-07-27", "2026-07-29"
    ]);
  });

  it("projects recurring occurrence status and move overrides without mutating the source", () => {
    const recurring = entry({
      id: "series",
      kind: "task",
      date: "2026-07-20",
      start: "09:00",
      end: "10:00",
      recurrence: "weekly",
      recurringDays: [1],
      recurrenceExceptions: {
        "2026-07-27": { status: "done", doneAt: "2026-07-27 18:00" },
      },
      recurrenceMoves: {
        "2026-07-27": { begin: "2026-07-28 14:00", end: "2026-07-28 15:00" },
      },
    });

    expect(entriesForDate([recurring], "2026-07-27")).toHaveLength(0);
    const [occurrence] = entriesForDate([recurring], "2026-07-28");
    expect(occurrence).toMatchObject({
      id: "series::recurrence::2026-07-27",
      recurrenceSourceId: "series",
      occurrenceDate: "2026-07-27",
      date: "2026-07-28",
      start: "14:00",
      end: "15:00",
      status: "done",
      doneAt: "2026-07-27 18:00",
    });
    expect(recurring).toMatchObject({ date: "2026-07-20", start: "09:00" });
    expect(recurring.status).toBeUndefined();
  });

  it("segments recurring cross-day entries using civil durations", () => {
    const overnight = entry({ id: "overnight", date: "2026-07-20", start: "23:00", end: "01:00", endDate: "2026-07-21", recurrence: "weekly", recurringDays: [1] });
    expect(classifyCrossDayEntry(overnight)).toBe("cross-day-short");
    expect(entrySegmentForDate(overnight, "2026-07-28")).toMatchObject({ startMinutes: 0, endMinutes: 60, continuesBefore: true, continuesAfter: false });
    expect(formatEntryTime(overnight, "zh")).toBe("23:00-(+1)01:00(2h)");
    expect(classifyCrossDayDateTimes("2026-07-20 23:00", "2026-07-21 01:00")).toBe("cross-day-short");
    expect(splitCrossDayDateTimeRange("2026-07-20 23:00", "2026-07-21 01:00")).toEqual([
      { date: "2026-07-20", startMinutes: 1380, endMinutes: 1440 },
      { date: "2026-07-21", startMinutes: 0, endMinutes: 60 }
    ]);
  });

  it("marks only completed entries as past, including overnight ranges", () => {
    const overnight = entry({ id: "overnight", date: "2026-09-11", start: "23:30", end: "07:00", endDate: "2026-09-12" });
    const ongoing = entry({ id: "ongoing", date: "2026-09-12", start: "07:00", end: "08:00" });
    expect(isEntryPast(overnight, "2026-09-11", 23 * 60 + 45)).toBe(false);
    expect(isEntryPast(overnight, "2026-09-12", 7 * 60)).toBe(true);
    expect(isEntryPast(ongoing, "2026-09-12", 7 * 60 + 30)).toBe(false);
    expect(isEntryPast(ongoing, "2026-09-12", 8 * 60)).toBe(true);
  });

  it("gives non-recurring cross-day timed entries a segment on every covered day", () => {
    const overnight = entry({ id: "overnight", date: "2026-07-20", start: "09:30", end: "08:00", endDate: "2026-07-21" });
    expect(classifyCrossDayEntry(overnight)).toBe("cross-day-short");
    expect(entriesForDate([overnight], "2026-07-21")).toHaveLength(1);
    const placements = layoutOverlappingEntries([overnight], "2026-07-21");
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ startMinutes: 0, endMinutes: 480, continuesBefore: true, continuesAfter: false });
  });

  it("stops non-recurring cross-day entries at their explicit civil end date", () => {
    const overnight = entry({ id: "overnight", date: "2026-07-20", start: "03:30", end: "02:00", endDate: "2026-07-21" });
    expect(entrySegmentForDate(overnight, "2026-07-20")).toBeTruthy();
    expect(entrySegmentForDate(overnight, "2026-07-21")).toBeTruthy();
    expect(entrySegmentForDate(overnight, "2026-07-22")).toBeNull();
  });

  it("keeps daily/weekly paths in the shared date domain", () => {
    const newYearWeek = new Date(2026, 11, 31);
    expect(getWeeklyFilePath("Diary", newYearWeek)).toBe("Diary/2026/12/2026-W53.md");
    expect(getWeeklyFilePath("Diary", new Date(2027, 0, 1))).toBe("Diary/2026/12/2026-W53.md");
    expect(getDailyFilePath("Diary", new Date(2026, 6, 26))).toBe("Diary/2026/07/2026-07-26.md");
    expect(getDatesInWeek(new Date(2026, 6, 26)).map((date) => date.getDate())).toEqual([20, 21, 22, 23, 24, 25, 26]);
  });

  it("lays out collision groups in deterministic reusable columns", () => {
    const entries = [
      entry({ id: "a", date: "2026-07-26", start: "09:00", end: "10:00" }),
      entry({ id: "b", date: "2026-07-26", start: "09:30", end: "11:00" }),
      entry({ id: "c", date: "2026-07-26", start: "10:00", end: "10:30" }),
      entry({ id: "d", date: "2026-07-26", start: "11:00", end: "12:00" })
    ];
    expect(layoutOverlappingEntries(entries, "2026-07-26").map(({ entry: value, column, columnCount }) => [value.id, column, columnCount])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
      ["d", 0, 1]
    ]);
  });

  it("reserves rendered minimum heights when laying out short timed entries", () => {
    const entries = [
      entry({ id: "bill", kind: "bill", date: "2026-07-26", start: "10:00", amount: -12 }),
      entry({ id: "event", date: "2026-07-26", start: "10:10", end: "10:20" }),
    ];
    const placements = layoutOverlappingEntries(entries, "2026-07-26", 1);
    expect(placements.map(({ entry: value, column, columnCount, groupId }) => [value.id, column, columnCount, groupId])).toEqual([
      ["bill", 0, 2, 0],
      ["event", 1, 2, 0],
    ]);
  });

  it("shares semantic/minimum-footprint overlap packing with compatibility clients", () => {
    const placements = layoutTimedOverlaps([
      { id: "low", startMinutes: 600, endMinutes: 605, minimumMinutes: 20, priority: "low" },
      { id: "high", startMinutes: 616, endMinutes: 620, minimumMinutes: 20, priority: "high" }
    ]);
    expect(placements.map(({ id, column, columnCount }) => [id, column, columnCount])).toEqual([
      ["high", 0, 2],
      ["low", 1, 2]
    ]);
  });

  it("reserves edge-clamped midnight footprints when packing overlap columns", () => {
    const entries = [
      entry({ id: "early", date: "2026-07-26", start: "23:35", end: "23:37" }),
      entry({ id: "late", date: "2026-07-26", start: "23:50", end: "23:55" }),
    ];
    const placements = layoutOverlappingEntries(entries, "2026-07-26", 1);
    expect(placements.map(({ entry: value, column, columnCount }) => [value.id, column, columnCount])).toEqual([
      ["early", 0, 2],
      ["late", 1, 2],
    ]);
  });
});
