import { describe, expect, it } from "vitest";
import { buildSmartCapturePrompt, extractAIJson, normalizeAIStructuredResult } from "./ai";
import { createDefaultSettings } from "./settings";
import { useExampleCatalogs } from "./testFixtures";

const settings = useExampleCatalogs(createDefaultSettings());

describe("provider-independent AI capture schema", () => {
  it("extracts fenced JSON after private reasoning", () => {
    expect(extractAIJson('<think>ignore me</think>\n```json\n{"entries":[]}\n```')).toEqual({ entries: [] });
  });

  it("normalizes legacy full timestamps, overnight ranges and configured categories", () => {
    const result = normalizeAIStructuredResult({ entries: [{
      modality: "event",
      title: "Night train",
      begin: "2026-08-08 23:30",
      end: "2026-08-09 01:10",
      category: "alpha",
      apiKey: "must be dropped",
    }] }, "2026-08-07", settings);
    expect(result.candidates[0].draft).toMatchObject({
      kind: "event", date: "2026-08-08", start: "23:30", end: "01:10", endDate: "2026-08-09", category: "alpha",
    });
    expect(result.candidates[0].draft).not.toHaveProperty("apiKey");
    expect(result.candidates[0].issues).toEqual([]);
  });

  it("accepts common model aliases and relative dates", () => {
    const result = normalizeAIStructuredResult({ entries: [{
      type: "event",
      title: "Call",
      date: "明天",
      allDay: false,
      time: "15:00",
      duration: "1小时",
      category: "event: beta",
    }] }, "2026-08-07", settings);
    expect(result.candidates[0].draft).toMatchObject({
      kind: "event", date: "2026-08-08", start: "15:00", end: "16:00", category: "beta",
    });
    expect(result.candidates[0].issues).toEqual([]);
  });

  it("recovers a small model that puts the end clock in endDate", () => {
    const result = normalizeAIStructuredResult({ entries: [{
      kind: "event",
      title: "Project meeting",
      date: "2026-09-05",
      allDay: false,
      start: "15:00",
      endDate: "16:00",
      category: "Beta",
    }] }, "2026-09-04", settings);
    expect(result.candidates[0].draft).toMatchObject({ start: "15:00", end: "16:00", endDate: undefined });
    expect(result.candidates[0].issues).toEqual([]);
  });

  it("keeps invalid candidates visible for preview instead of silently creating them", () => {
    const result = normalizeAIStructuredResult([{ kind: "unknown", title: "", date: "not-a-date" }], "2026-08-07", settings);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["invalid-kind", "missing-title", "invalid-date"]));
  });

  it("keeps an explicitly timed but incomplete draft blocked in preview", () => {
    const result = normalizeAIStructuredResult({ entries: [{ kind: "event", title: "Call", date: "2026-08-07", allDay: false, category: "Beta" }] }, "2026-08-07", settings);
    expect(result.candidates[0].issues.map((issue) => issue.code)).toContain("missing-start");
    expect(normalizeAIStructuredResult({ entries: [{ kind: "event", title: "Call", date: "2026-08-07", allDay: false, start: "10:00", end: "09:00", category: "Beta" }] }, "2026-08-07", settings).candidates[0].issues).toEqual([]);
  });

  it("builds a schema-constrained prompt without provider-specific fields", () => {
    const prompt = buildSmartCapturePrompt("明天午餐 36 元", "2026-08-07 18:00", "zh", settings);
    expect(prompt.messages[0].content).toContain("Allowed categories");
    expect(prompt.messages[0].content).toContain("next Monday/下周一: 2026-08-10");
    expect(prompt.messages[0].content).toContain("next Sunday/下周日: 2026-08-09");
    expect(JSON.stringify(prompt.responseSchema)).toContain('"required":["kind","title","date","allDay","start","end","endDate","category"]');
    expect(prompt.messages[1]).toEqual({ role: "user", content: "明天午餐 36 元" });
    expect(prompt.responseSchema).toHaveProperty("properties.entries");
  });
});
