import { describe, expect, it } from "vitest";
import type { Entry, EntryKind } from "./entry";
import { buildTimelineDays, groupTimelineItems, timelineDayKeys, type TimelineDay } from "./agendaTimeline";

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "title" | "date">): Entry {
  return {
    kind: "task",
    allDay: true,
    category: "work",
    color: "#77787b",
    createdAt: "2026-08-10T00:00:00Z",
    ...overrides,
  } as Entry;
}

const base = {
  filter: [] as EntryKind[],
  search: "",
  locale: "en" as const,
  selectedKey: "2026-08-10",
};

describe("agenda timeline engine", () => {
  it("bands all-day above timed above bills, and orders the timed band by the clock", () => {
    const entries = [
      entry({ id: "a", title: "Coffee", date: "2026-08-10", kind: "bill", amount: -12, allDay: true }),
      entry({ id: "b", title: "Standup", date: "2026-08-10", kind: "event", allDay: false, start: "09:30", end: "09:45" }),
      entry({ id: "c", title: "Write spec", date: "2026-08-10", kind: "task", allDay: true }),
      entry({ id: "d", title: "Deep work", date: "2026-08-10", kind: "task", allDay: false, start: "14:00", end: "16:00" }),
    ];
    const [day] = buildTimelineDays({
      ...base,
      entries,
      dayKeys: ["2026-08-10"],
      includeEmptyDays: true,
      startDateOnly: false,
    });
    // 09:30 before 14:00 even though the 14:00 item is a task and the 09:30 one
    // is an event: kind must not reorder the clock, or this list disagrees with
    // the Day grid about what happens next.
    expect(day.entries.map((item) => item.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("uses priority only to break a same-minute tie", () => {
    const entries = [
      entry({ id: "low", title: "Low", date: "2026-08-10", kind: "task", allDay: false, start: "11:00", priority: "low" }),
      entry({ id: "high", title: "High", date: "2026-08-10", kind: "task", allDay: false, start: "11:00", priority: "high" }),
      entry({ id: "early", title: "Early", date: "2026-08-10", kind: "task", allDay: false, start: "08:00", priority: "low" }),
    ];
    const [day] = buildTimelineDays({
      ...base,
      entries,
      dayKeys: ["2026-08-10"],
      includeEmptyDays: true,
      startDateOnly: false,
    });
    // A high-priority 11:00 item does NOT jump above an 08:00 one.
    expect(day.entries.map((item) => item.id)).toEqual(["early", "high", "low"]);
  });

  it("keeps a day's expense total independent of the active kind filter", () => {
    const entries = [
      entry({ id: "a", title: "Lunch", date: "2026-08-10", kind: "bill", amount: -30 }),
      entry({ id: "b", title: "Review", date: "2026-08-10", kind: "task" }),
    ];
    const [day] = buildTimelineDays({
      ...base,
      filter: ["task"] as EntryKind[],
      entries,
      dayKeys: ["2026-08-10"],
      includeEmptyDays: true,
      startDateOnly: false,
    });
    expect(day.entries.map((item) => item.id)).toEqual(["b"]);
    expect(day.expense).toBe(30);
  });

  it("shows a spanning occurrence once under startDateOnly and on every day without it", () => {
    // A weekly Monday event that runs Mon-Wed. `entriesForDate` projects the
    // Monday occurrence onto Tuesday and Wednesday too, so this is exactly the
    // case where List must not print three cards for one trip.
    const entries = [
      entry({
        id: "trip",
        title: "Trip",
        date: "2026-08-10",
        endDate: "2026-08-12",
        allDay: true,
        kind: "event",
        recurrence: "weekly",
        recurringDays: [1],
      }),
    ];
    const dayKeys = ["2026-08-10", "2026-08-11", "2026-08-12"];
    const once = buildTimelineDays({ ...base, entries, dayKeys, includeEmptyDays: true, startDateOnly: true });
    expect(once.map((day) => day.entries.length)).toEqual([1, 0, 0]);
    const every = buildTimelineDays({ ...base, entries, dayKeys, includeEmptyDays: true, startDateOnly: false });
    expect(every.map((day) => day.entries.length)).toEqual([1, 1, 1]);
  });

  it("drops empty days unless they are selected when empties are excluded", () => {
    const entries = [entry({ id: "a", title: "Review", date: "2026-08-12" })];
    const days = buildTimelineDays({
      ...base,
      entries,
      dayKeys: timelineDayKeys(new Date(2026, 7, 9), 5),
      includeEmptyDays: false,
      startDateOnly: true,
    });
    // 08-09 and 08-11 carry nothing; 08-10 survives because it is selected.
    expect(days.map((day) => day.key)).toEqual(["2026-08-10", "2026-08-12"]);
  });

  it("emits one week header per calendar week, in order", () => {
    const days: TimelineDay[] = ["2026-08-07", "2026-08-10", "2026-08-11", "2026-08-17"].map((key) => ({
      date: new Date(`${key}T00:00:00`),
      key,
      entries: [],
      expense: 0,
      selected: false,
    }));
    const items = groupTimelineItems(days, 1);
    expect(items.map((item) => (item.type === "week" ? `W:${item.key}` : item.key))).toEqual([
      "W:week:2026-08-03",
      "day:2026-08-07",
      "W:week:2026-08-10",
      "day:2026-08-10",
      "day:2026-08-11",
      "W:week:2026-08-17",
      "day:2026-08-17",
    ]);
  });

  it("builds contiguous ascending day keys", () => {
    expect(timelineDayKeys(new Date(2026, 7, 30), 3)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });
});
