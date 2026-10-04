import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../settings";
import { CaptureDecisionIndex, completeCapture, parseAssetCapture, parseCapture, splitCaptureItems } from "./index";
const settings = createDefaultSettings("en");
settings.calendars[0].categories.push({ id: "work", name: "Deep Work", color: "#123456" });
const options = { settings, now: new Date(2026, 9, 4, 9), locale: "en" as const };

describe("explicit local capture", () => {
  it("mixes commands, quoted values, tags and natural time", () => {
    const result = parseCapture('/task tomorrow 09:00-10:00 Review @"Meeting room" %"Deep Work" #team !high !!low status:in-progress', options);
    expect(result.draft).toMatchObject({ kind: "task", title: "Review", date: "2026-10-05", start: "09:00", end: "10:00", location: "Meeting room", category: "work", tags: ["team"], priority: "high", urgency: "low", status: "in-progress" });
    expect(result.issues).toEqual([]);
    expect(result.explicitFields).toContain("category");
  });
  it("does not let money change an explicit idea into a bill", () => {
    const result = parseCapture("/idea $20 garden", options);
    expect(result.draft.kind).toBe("idea");
    expect(result.draft.amount).toBeUndefined();
    expect(result.issues).toContainEqual({ field: "amount", value: "-20", code: "conflict" });
  });
  it("retains conflicts and unknown categories for confirmation", () => {
    const result = parseCapture('/event Review @Home @Office %missing !wrong', options);
    expect(result.issues.map(issue => issue.field)).toEqual(["location", "priority", "category"]);
    expect(result.draft.location).toBe("Home");
    expect(result.draft.title).toContain("!wrong");
  });
  it("extracts reminders before they can turn into a duration", () => {
    const result = parseCapture("/task every Monday 09:00 Review remind me 15 minutes before", options);
    expect(result.draft).toMatchObject({ recurrence: "weekly", recurringDays: [1], reminder: "15min", start: "09:00", end: "10:00", title: "Review" });
  });
  it("recognizes Chinese repeat weekdays and reminder", () => {
    const result = parseCapture("/待办 每周一、三 9点 复习 提前30分钟提醒", options);
    expect(result.draft).toMatchObject({ kind: "task", recurrence: "weekly", recurringDays: [1, 3], reminder: "30min", title: "复习" });
  });
  it("keeps links separate until a concrete object is selected", () => {
    const result = parseCapture('/bill Laptop $900 &device-id', options);
    expect(result.link).toBe("device-id");
    expect(result.draft).toMatchObject({ kind: "bill", amount: -900, currency: "USD", title: "Laptop" });
  });
  it("hands asset values to the existing item editor", () => {
    const result = parseAssetCapture('/asset tomorrow 15:00 Laptop $900 @Home', options);
    expect(result.draft).toMatchObject({ name: "Laptop", acquiredOn: "2026-10-05", acquiredAt: "15:00", cost: 900, currency: "USD", location: "Home", acquisition: "purchase" });
  });
  it("completes only the active token and quotes spaces", () => {
    expect(completeCapture("Review @Mee", { categories: [], locations: ["Meeting room", "Home"], tags: [] })).toEqual([{ value: '@"Meeting room"', label: "Meeting room" }]);
    expect(completeCapture("text /as", { categories: [], locations: [], tags: [] })[0].value).toBe("/asset");
  });
  it("does not prefill weak, conflicting, cross-calendar history or old notes", () => {
    const history = [
      { id: "a", kind: "event" as const, title: "Review", category: "work", location: "Home", note: "Secret", date: "2026-10-01", calendar: settings.defaultCalendarID },
      { id: "b", kind: "event" as const, title: "Review", category: "default", location: "Office", date: "2026-10-02", calendar: settings.defaultCalendarID },
      { id: "c", kind: "task" as const, title: "Review", category: "work", location: "Elsewhere", date: "2026-10-03", calendar: "other" },
    ];
    const result = parseCapture("Review", { ...options, history, decisionIndex: new CaptureDecisionIndex(history) });
    expect(result.decisions.location.selected).toBeUndefined();
    expect(result.draft.note).toBeUndefined();
    expect(result.decisions.location.options.map(value => value.value)).not.toContain("Elsewhere");
  });
  it("keeps punctuation in quoted values and parses grouped currency amounts", () => {
    expect(splitCaptureItems('/event Review @"Room A; floor 2"; /bill Desk $1,200.25')).toEqual(['/event Review @"Room A; floor 2"', '/bill Desk $1,200.25']);
    expect(parseCapture('/bill Desk $1,200.25', options).draft.amount).toBe(-1200.25);
  });
  it("does not reinterpret unsupported reminders as event durations", () => {
    const result = parseCapture('/event Review 09:00 remind me 10 minutes before', options);
    expect(result.draft.end).toBe("10:00");
    expect(result.issues).toContainEqual({ field: "reminder", value: "remind me 10 minutes before", code: "unsupported" });
  });
  it("keeps local indexed parsing comfortably below an interactive budget", () => {
    const history = Array.from({ length: 1500 }, (_, index) => ({ id: String(index), kind: "event" as const, title: `Project ${index} review`, category: "work", date: "2026-10-01" }));
    const decisionIndex = new CaptureDecisionIndex(history);
    const start = performance.now();
    for (let index = 0; index < 20; index++) parseCapture(`/task tomorrow 09:00 Project ${index} review @Office #work`, { ...options, history, decisionIndex });
    expect((performance.now() - start) / 20).toBeLessThan(150);
  });
  it("does not parse incomplete syntax as a field", () => {
    const result = parseCapture('/task Review @ # %', options);
    expect(result.draft.title).toBe("Review @ # %");
    expect(result.draft.location).toBeUndefined();
  });
});
