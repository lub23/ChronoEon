import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "./settings";
import { useExampleCatalogs } from "./testFixtures";
import {
  DEFAULT_CHRONOEON_SETTINGS,
  categoryOptionsForKind,
  createDeterministicEntryId,
  createEntryId,
  isAppView,
  isStableEntryId,
  normalizeChronoEonSettings,
  resolveEntryColor,
  timedItemMinHeightPx
} from "./index";

describe("shared domain", () => {
  it("generates UUID IDs", () => {
    const id = createEntryId();
    expect(isStableEntryId(id)).toBe(true);
  });

  it("keeps migration IDs deterministic so repeated imports are stable", () => {
    expect(createDeterministicEntryId("same")).toBe(createDeterministicEntryId("same"));
    expect(isStableEntryId(createDeterministicEntryId("same"))).toBe(true);
  });

  it("recognizes only the current view vocabulary", () => {
    expect(isAppView("agenda")).toBe(true);
    expect(isAppView("list")).toBe(false);
    expect(isAppView(undefined)).toBe(false);
  });

  it("reserves a compact title-only height for edge-clamped timed chips", () => {
    expect(timedItemMinHeightPx(false, 0.6)).toBe(21);
    expect(timedItemMinHeightPx(true, 0.6)).toBe(22);
  });

  it("normalizes known type settings without retaining unrelated fields", () => {
    const settings = normalizeChronoEonSettings({
      language: "zh",
      firstDay: 0,
      migrateOnModeSwitch: false,
      diaryMode: "weekly",
      remoteLLMApiKey: "must-not-copy",
      calendars: [{
        id: "default",
        name: "默认",
        folder: "Diary",
        categories: [{ id: "Beta", name: "Beta", color: "#f47920" }],
        defaultCategoryId: "Beta"
      }],
      bill: {
        categories: [{ id: "food", name: "Expense", color: "#8f4b2e", sub: ["Daily"] }],
        currency: "cny",
        paymentMethods: ["支付宝"]
      }
    });

    expect(settings).toMatchObject({ language: "zh", firstDay: 0, migrateOnModeSwitch: false, diaryMode: "weekly" });
    // The stored catalog is authoritative: nothing is re-injected around it.
    expect(settings.calendars[0].categories.map((category) => category.id)).toEqual(["Beta"]);
    expect(settings.calendars[0].defaultCategoryId).toBe("Beta");
    expect(settings.bill.currency).toBe("CNY");
    expect(settings.bill.paymentMethods).toEqual(["支付宝"]);
    expect(settings).not.toHaveProperty("remoteLLMApiKey");
  });

  it("uses the configured bill hierarchy and colors", () => {
    const settings = useExampleCatalogs(createDefaultSettings());
    const daily = categoryOptionsForKind("bill", settings).find((option) => option.value === "Expense/Daily");
    expect(daily).toMatchObject({ group: "Expense", color: "#c0392b" });
    expect(resolveEntryColor("Expense/Daily", "bill", settings)).toBe("#c0392b");
    expect(DEFAULT_CHRONOEON_SETTINGS.bill.paymentMethods).toContain("WeChat");
  });
});
