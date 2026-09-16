import { describe, expect, it } from "vitest";
import type { Entry } from "./entry";
import { EMPTY_ENTRY_FILTER, entryMatchesFilter, filterActive, toggleValue } from "./entryFilter";

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "task",
    title: "T",
    date: "2026-08-10",
    allDay: true,
    category: "work",
    calendar: "default",
    color: "#77787b",
    createdAt: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

describe("entry filter", () => {
  it("matches everything when empty", () => {
    expect(filterActive(EMPTY_ENTRY_FILTER)).toBe(false);
    expect(entryMatchesFilter(entry({}), EMPTY_ENTRY_FILTER)).toBe(true);
  });

  it("filters by category and calendar (missing calendar = default)", () => {
    const filter = { ...EMPTY_ENTRY_FILTER, categories: ["work"], calendarIds: ["default"] };
    expect(entryMatchesFilter(entry({ category: "work" }), filter)).toBe(true);
    expect(entryMatchesFilter(entry({ category: "life" }), filter)).toBe(false);
    expect(entryMatchesFilter(entry({ calendar: undefined }), filter)).toBe(true);
    expect(entryMatchesFilter(entry({ calendar: "work" }), filter)).toBe(false);
  });

  it("treats photos-only as a view mode rather than an entry predicate", () => {
    // The views hide every chip themselves; the day's photos are still read
    // from the entries, so an entry must never be filtered out by this flag.
    const filter = { ...EMPTY_ENTRY_FILTER, photosOnly: true };
    expect(filterActive(filter)).toBe(true);
    expect(entryMatchesFilter(entry({}), filter)).toBe(true);
    expect(entryMatchesFilter(entry({ images: ["photos/a.jpg"] }), filter)).toBe(true);
  });

  it("keeps matching category names independent across schedule and ledger groups", () => {
    const filter = { ...EMPTY_ENTRY_FILTER, categories: [] };
    expect(entryMatchesFilter(entry({ category: "work", kind: "event" }), filter)).toBe(false);
    expect(entryMatchesFilter(entry({ category: "work", kind: "bill" }), filter)).toBe(true);
    expect(entryMatchesFilter(entry({ kind: "bill" }), { ...filter, billCategories: [] })).toBe(false);
  });

  it("toggles membership without mutating the input", () => {
    const original = ["a", "b"];
    expect(toggleValue(original, "c")).toEqual(["a", "b", "c"]);
    expect(toggleValue(original, "a")).toEqual(["b"]);
    expect(original).toEqual(["a", "b"]);
  });
});
