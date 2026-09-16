import { describe, expect, it } from "vitest";
import { contrastRatio } from "./colors";
import { createDefaultSettings } from "./settings";
import { useExampleCatalogs } from "./testFixtures";
import { resolveEntryColors, resolveEntryFill } from "./itemColors";

const settings = useExampleCatalogs(createDefaultSettings());

describe("canonical entry colours", () => {
  it("matches a normal category by id or display name", () => {
    expect(resolveEntryFill({ kind: "task", category: "alpha", calendar: "default" }, settings)).toBe("#90d7ec");
    expect(resolveEntryFill({ kind: "task", category: "beta", calendar: "Default" }, settings)).toBe("#f47920");
  });

  it("uses a bill primary colour for its subcategory", () => {
    expect(resolveEntryFill({ kind: "bill", category: "Expense/Daily", calendar: "default" }, settings)).toBe("#c0392b");
  });

  it("keeps the colour a stored catalog actually carries", () => {
    const edited = createDefaultSettings();
    edited.calendars[0].categories = [{ id: "catalog-abc", name: "Reading", color: "#65c294" }];
    edited.calendars[0].defaultCategoryId = "catalog-abc";
    expect(resolveEntryFill({ kind: "task", category: "catalog-abc" }, edited)).toBe("#65c294");
    expect(resolveEntryFill({ kind: "task", category: "Reading" }, edited)).toBe("#65c294");
  });

  it("preserves a legacy custom colour only when its category is no longer configured", () => {
    expect(resolveEntryFill({ kind: "event", category: "removed-category", color: "#123456" }, settings)).toBe("#123456");
  });

  it("keeps the calendar accent separate and returns readable text", () => {
    const colors = resolveEntryColors({ kind: "event", category: "beta", calendar: "default" }, settings);
    expect(colors).toMatchObject({ fill: "#f47920", accent: "#90d7ec" });
    // The label colour is whichever candidate MEASURES better on this fill. For
    // the orange Beta fill, dark ink wins; the assertion still verifies the
    // choice rather than assuming one text colour for every catalog entry.
    expect(colors.text.toLowerCase()).toBe("#1f2937");
    const chosen = contrastRatio(colors.fill, colors.text) ?? 0;
    const rejected = contrastRatio(colors.fill, "#ffffff") ?? 0;
    expect(chosen).toBeGreaterThan(rejected);
  });

  it("never returns the lower-contrast label colour for any catalog fill", () => {
    const fills = new Set<string>();
    for (const category of ["alpha", "beta", "Alpha", "Beta", "uncategorized", "removed-category"]) {
      for (const kind of ["task", "event", "bill", "idea"] as const) {
        fills.add(resolveEntryFill({ kind, category, calendar: "default" }, settings));
      }
    }
    for (const fill of fills) {
      const text = resolveEntryColors({ kind: "event", color: fill, category: "removed-category" }, settings).text;
      const chosen = contrastRatio(fill, text) ?? 0;
    const other = contrastRatio(fill, text.toLowerCase() === "#ffffff" ? "#1f2937" : "#ffffff") ?? 0;
      expect(chosen, `${fill} -> ${text}`).toBeGreaterThanOrEqual(other);
    }
  });
});
