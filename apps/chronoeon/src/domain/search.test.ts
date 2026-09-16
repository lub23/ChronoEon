import { describe, expect, it } from "vitest";
import type { Entry } from "@chronoeon/domain";
import { entryMatchesSearch } from "./search";

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: "e1",
    kind: "event",
    title: "Design review",
    date: "2026-07-27",
    category: "work",
    color: "#777777",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  } as Entry;
}

describe("entry search", () => {
  it("matches an empty query so an unfiltered view shows everything", () => {
    expect(entryMatchesSearch(entry({}), "   ", "en")).toBe(true);
  });

  it("searches the fields shown on a row, not just the title", () => {
    const meeting = entry({ location: "Studio B", note: "bring the printouts", tags: ["focus"] });
    expect(entryMatchesSearch(meeting, "studio", "en")).toBe(true);
    expect(entryMatchesSearch(meeting, "printouts", "en")).toBe(true);
    expect(entryMatchesSearch(meeting, "focus", "en")).toBe(true);
    expect(entryMatchesSearch(meeting, "unrelated", "en")).toBe(false);
  });

  it("treats a leading # as a tag-only search", () => {
    const tagged = entry({ title: "focus block", tags: ["deep"] });
    expect(entryMatchesSearch(tagged, "#deep", "en")).toBe(true);
    // The title contains "focus" but no such tag exists, so the tag query fails.
    expect(entryMatchesSearch(tagged, "#focus", "en")).toBe(false);
  });

  it("matches the localized title and category of a Chinese entry", () => {
    const zh = entry({ title: "Weekly review", titleZh: "周会复盘", category: "工作" });
    expect(entryMatchesSearch(zh, "复盘", "zh")).toBe(true);
    expect(entryMatchesSearch(zh, "工作", "zh")).toBe(true);
    expect(entryMatchesSearch(zh, "WEEKLY", "en")).toBe(true);
  });
});
