import { describe, expect, it } from "vitest";
import { applyCalendarDrag } from "./calendar";

describe("calendar drag projection", () => {
  it("moves a timed entry across civil days without timezone drift", () => {
    expect(applyCalendarDrag({ date: "2026-07-26", start: "23:30", end: "23:50", allDay: false }, { minutes: 60 })).toMatchObject({
      date: "2026-07-27",
      start: "00:30",
      end: "00:50",
      allDay: false,
    });
  });

  it("moves backward across a civil-day boundary", () => {
    expect(applyCalendarDrag({ date: "2026-07-26", start: "00:15", end: "01:00", allDay: false }, { minutes: -30 })).toMatchObject({
      date: "2026-07-25",
      start: "23:45",
      end: "00:30",
      endDate: "2026-07-26",
    });
  });

  it("preserves legacy overnight ranges whose end time wraps", () => {
    expect(applyCalendarDrag({ date: "2026-07-26", start: "23:00", end: "01:00", allDay: false }, { minutes: 30 })).toMatchObject({
      date: "2026-07-26",
      start: "23:30",
      end: "01:30",
      endDate: "2026-07-27",
    });
  });

  it("preserves a multi-day duration while moving", () => {
    expect(applyCalendarDrag({ date: "2026-07-26", start: "22:00", end: "01:00", endDate: "2026-07-27", allDay: false }, { days: 1 })).toMatchObject({
      date: "2026-07-27",
      start: "22:00",
      end: "01:00",
      endDate: "2026-07-28",
    });
  });

  it("moves a resized start edge to the previous civil day", () => {
    expect(applyCalendarDrag({ date: "2026-07-26", start: "09:00", end: "10:00", allDay: false }, { days: -1, edge: "resize-start" })).toMatchObject({
      date: "2026-07-25",
      start: "09:00",
      end: "10:00",
      endDate: "2026-07-26",
    });
  });

  it("moves a resized end edge to the next civil day", () => {
    expect(applyCalendarDrag({ date: "2026-07-26", start: "10:00", end: "11:00", allDay: false }, { days: 1, edge: "resize-end" })).toMatchObject({
      date: "2026-07-26",
      start: "10:00",
      end: "11:00",
      endDate: "2026-07-27",
    });
  });

  it("keeps resize handles at least fifteen minutes apart", () => {
    expect(applyCalendarDrag({ date: "2026-07-26", start: "10:00", end: "11:00", allDay: false }, { minutes: 90, edge: "resize-start" })).toMatchObject({
      date: "2026-07-26",
      start: "10:45",
      end: "11:00",
    });
    expect(applyCalendarDrag({ date: "2026-07-26", start: "10:00", end: "11:00", allDay: false }, { minutes: -90, edge: "resize-end" })).toMatchObject({
      start: "10:00",
      end: "10:15",
    });
  });

  it("moves all-day spans by whole days", () => {
    expect(applyCalendarDrag({ date: "2026-07-26", endDate: "2026-07-28", allDay: true }, { days: 2, edge: "move" })).toEqual({
      date: "2026-07-28",
      endDate: "2026-07-30",
      allDay: true,
    });
  });

  it("resizes all-day span edges across civil days without losing duration", () => {
    const entry = { date: "2026-07-26", endDate: "2026-07-28", allDay: true };
    expect(applyCalendarDrag(entry, { days: -1, edge: "resize-start" })).toEqual({
      date: "2026-07-25",
      endDate: "2026-07-28",
      allDay: true,
    });
    expect(applyCalendarDrag(entry, { days: 1, edge: "resize-end" })).toEqual({
      date: "2026-07-26",
      endDate: "2026-07-29",
      allDay: true,
    });
  });
});

describe("calendar lane conversion", () => {
  it("keeps the occupied dates when a timed range is pulled all-day", async () => {
    const { convertCalendarEntryToAllDay } = await import("./calendar");
    expect(convertCalendarEntryToAllDay(
      { date: "2026-07-22", start: "20:00", end: "00:00", endDate: "2026-07-23" },
      "2026-07-22",
      "2026-07-25",
    )).toEqual({ date: "2026-07-25", endDate: undefined, start: undefined, end: undefined, allDay: true });
  });

  it("creates a short timed block and clamps it inside its target day", async () => {
    const { convertCalendarEntryToTimed } = await import("./calendar");
    expect(convertCalendarEntryToTimed("2026-07-22", 23 * 60 + 50, 30)).toEqual({
      date: "2026-07-22",
      start: "23:30",
      end: "00:00",
      endDate: "2026-07-23",
      allDay: false,
    });
  });
});
