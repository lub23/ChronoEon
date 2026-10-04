import { describe, it, expect } from "vitest";
import { createDefaultSettings, type CaptureHistoryItem, type EntryDraft } from "@chronoeon/domain";
import { refineCapture } from "./captureRefinement";
const settings = createDefaultSettings("en");
const history: CaptureHistoryItem[] = [
  { kind: "event", title: "Yoga", category: "default", location: "Gym", note: "Bring mat", date: "2026-09-29" },
  { kind: "event", title: "Design review", category: "default", location: "Office", note: "Bring slides", date: "2026-09-29" },
];
const options = { settings, history, now: new Date(2026, 8, 30, 9), locale: "en" as const };
const initial: EntryDraft = { kind: "event", title: "Yoga", date: "2026-10-02", start: "09:00", end: "10:00", category: "default", calendar: settings.defaultCalendarID };
describe("adaptive capture fields", () => {
  it("recomputes bill direction from a manually edited signed amount", () => {
    const next = refineCapture({ draft: { ...initial, kind: "bill" as const, amount: -20 } }, { amount: 20 }, options);
    const income = settings.calendars[0].billCategories.find(category => category.direction === "income")!;
    expect(next.draft.category.split("/")[0]).toBe(income.id);
    expect(next.draft.amount).toBe(20);
  });
  it("follows the title, reranks candidates and clears obsolete learned fields", () => {
    const first = refineCapture({ draft: initial }, { title: "Yoga" }, options);
    expect(first.draft.location).toBe("Gym");
    const next = refineCapture(first, { title: "Design review" }, options);
    expect(next.draft.location).toBe("Office");
    expect(next.decisions?.location.options[0].value).toBe("Office");
    expect(next.draft.date).toBe(initial.date);
    const empty = refineCapture(next, { title: "" }, options);
    expect(empty.draft.location).toBeUndefined();
  });
  it("keeps cleared, selected and typed fields while refreshing candidates", () => {
    const first = refineCapture({ draft: initial }, { location: undefined, note: "My note", category: "my-category" }, options);
    const next = refineCapture(first, { title: "Design review" }, options);
    expect(next.draft.location).toBeUndefined();
    expect(next.draft.note).toBe("My note");
    expect(next.draft.category).toBe("my-category");
    expect(next.decisions?.location.options[0].value).toBe("Office");
  });
  it("uses explicit new times and restores the baseline when cues are removed", () => {
    const next = refineCapture({ draft: initial }, { title: "Yoga 14:00-15:00" }, options);
    expect(next.draft.start).toBe("14:00");
    expect(next.draft.date).toBe("2026-10-02");
    const restored = refineCapture(next, { title: "Yoga" }, options);
    expect(restored.draft.start).toBe("09:00");
  });
  it("preserves explicit source fields and later user corrections", () => {
    const item = { draft: { ...initial, tags: ["original"], location: "Chosen room", priority: "high" as const }, touched: ["tags", "location", "priority"] as Array<keyof EntryDraft> };
    const next = refineCapture(item, { title: "Design review @Office #other !low" }, options);
    expect(next.draft).toMatchObject({ location: "Chosen room", tags: ["original"], priority: "high" });
    expect(next.draft.note).toBeUndefined();
  });
  it("does not learn fields from another calendar or replace a manually chosen kind", () => {
    const next = refineCapture({ draft: initial }, { title: "Yoga", kind: "task" }, { ...options, history: history.map(entry => ({ ...entry, calendar: "other" })) });
    expect(next.draft.kind).toBe("task");
    expect(next.draft.location).toBeUndefined();
  });
});
