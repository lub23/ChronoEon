import { describe, expect, it } from "vitest";
import type { Entry, EntryDraft } from "./entry";
import { entryToDraft, entryWithDraft, entryWithOccurrenceMove, entryWithOccurrenceStatus, sourceEntryId } from "./entryWorkflow";

const source: Entry = {
  id: "018f47a2-6f89-4cc4-bf69-7f1703db0123",
  kind: "task",
  title: "Review",
  date: "2026-07-20",
  start: "09:00",
  end: "10:00",
  allDay: false,
  status: "open",
  calendar: "default",
  category: "work",
  color: "#77787b",
  recurrence: "weekly",
  recurringDays: [1],
  recurrenceExceptions: { "2026-07-27": { status: "done" } },
  recurringEnd: "2026-08-31",
  recurrenceMoves: { "2026-08-03": { begin: "2026-08-04 11:00", end: "2026-08-04 12:00" } },
  createdAt: "2026-07-20T00:00:00.000Z",
};

function draft(partial: Partial<EntryDraft> = {}): EntryDraft {
  return {
    kind: "task",
    title: "Review updated",
    date: "2026-07-20",
    start: "09:00",
    end: "10:00",
    allDay: false,
    category: "work",
    recurrence: "weekly",
    recurringDays: [3, 1, 3],
    recurringEnd: "2026-08-31",
    ...partial,
  };
}

describe("entry workflow", () => {
  it("round-trips editable schedule and recurrence fields into a draft", () => {
    expect(entryToDraft(source)).toMatchObject({
      kind: "task",
      title: "Review",
      date: "2026-07-20",
      start: "09:00",
      end: "10:00",
      recurrence: "weekly",
      recurringDays: [1],
      recurringEnd: "2026-08-31",
    });
  });

  it("normalizes recurrence edits and shifts per-occurrence metadata with the series", () => {
    const updated = entryWithDraft(source, draft({ date: "2026-07-21" }));
    expect(updated.recurringDays).toEqual([1, 3]);
    expect(updated.recurringEnd).toBe("2026-09-01");
    expect(updated.recurrenceExceptions?.["2026-07-28"]?.status).toBe("done");
    expect(updated.recurrenceMoves?.["2026-08-04"]).toEqual({
      begin: "2026-08-05 11:00",
      end: "2026-08-05 12:00",
    });
  });

  it("clears recurrence-only fields when recurrence is disabled", () => {
    const updated = entryWithDraft(source, draft({ recurrence: "none" }));
    expect(updated).toMatchObject({ recurrence: "none", recurringDays: undefined, recurringEnd: undefined });
    expect(updated.recurrenceExceptions).toBeUndefined();
    expect(updated.recurrenceMoves).toBeUndefined();
  });

  it("creates occurrence move and status overrides against the source ID", () => {
    const moved = entryWithOccurrenceMove(source, "2026-07-27", {
      date: "2026-07-28",
      start: "14:00",
      end: "15:00",
      allDay: false,
    });
    expect(moved.recurrenceMoves?.["2026-07-27"]).toEqual({ begin: "2026-07-28 14:00", end: "2026-07-28 15:00" });
    const completed = entryWithOccurrenceStatus(source, "2026-07-27", "done", "2026-07-27T18:00:00.000Z");
    expect(completed.recurrenceExceptions?.["2026-07-27"]).toMatchObject({ status: "done", doneAt: "2026-07-27T18:00:00.000Z" });
    expect(sourceEntryId({ id: `${source.id}::recurrence::2026-07-27`, recurrenceSourceId: source.id })).toBe(source.id);
  });
});
