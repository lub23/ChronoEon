import { describe, expect, it } from "vitest";
import { billCategoryOptions, createDefaultSettings, normalizeChronoEonSettings, scheduleCategoryOptions } from "./settings";

describe("category catalogs", () => {
  it("ships a default schedule catalog and neutral example bill catalog", () => {
    const english = createDefaultSettings();
    expect(english.locationAutofill).toBe(true);
    expect(english.calendars[0].categories).toEqual([{ id: "default", name: "Default", color: "#90d7ec" }]);
    expect(english.calendars[0].defaultCategoryId).toBe("default");
    expect(english.bill.categories).toEqual([
      { id: "income", name: "Income", color: "#2f8f5b", direction: "income", sub: ["Salary", "Bonus"] },
      { id: "expense", name: "Expense", color: "#c0392b", direction: "expense", sub: ["Daily", "Medical"] },
    ]);
    expect(english.bill.defaultCategoryId).toBe("income");
    expect(english.bill.defaultSubCategoryId).toBe("Salary");

    const chinese = createDefaultSettings("zh");
    expect(chinese.calendars[0].categories[0].name).toBe("默认分类");
    expect(chinese.bill.categories[0].name).toBe("收入");
    expect(chinese.bill.categories[0].sub).toEqual(["工资", "奖金"]);
    expect(chinese.bill.categories[1].name).toBe("消费");
    expect(chinese.bill.categories[1].sub).toEqual(["日常", "医疗"]);
    expect(chinese.bill.defaultSubCategoryId).toBe("工资");
  });

  it("keeps a stored catalog exactly as the user left it", () => {
    const settings = normalizeChronoEonSettings({
      calendars: [{
        id: "default",
        name: "Default",
        categories: [
          { id: "default", name: "Neutral", color: "#d71345" },
          { id: "catalog-abc", name: "Reading", color: "#65c294" },
        ],
        defaultCategoryId: "catalog-abc",
      }],
      bill: {
        categories: [{ id: "default", name: "Example", color: "#ea66a6", direction: "expense", sub: ["Sample"] }],
        defaultCategoryId: "default",
        defaultSubCategoryId: "Sample",
      },
    });

    const calendar = settings.calendars[0];
    expect(calendar.categories).toEqual([
      { id: "default", name: "Neutral", color: "#d71345" },
      { id: "catalog-abc", name: "Reading", color: "#65c294" },
    ]);
    expect(calendar.defaultCategoryId).toBe("catalog-abc");
    expect(settings.bill.categories).toEqual([{ id: "default", name: "Example", color: "#ea66a6", direction: "expense", sub: ["Sample"] }]);
  });

  it("falls back to one default category when a catalog is empty or damaged", () => {
    const settings = normalizeChronoEonSettings({
      calendars: [{ id: "default", name: "Default", categories: [], defaultCategoryId: "gone" }],
      bill: { categories: [{ id: 5 }], defaultCategoryId: "gone" },
    });
    expect(settings.calendars[0].categories).toHaveLength(1);
    expect(settings.calendars[0].defaultCategoryId).toBe(settings.calendars[0].categories[0].id);
    expect(settings.bill.categories).toHaveLength(2);
  });

  it("keeps the user's location-autofill choice", () => {
    expect(normalizeChronoEonSettings({ locationAutofill: false }).locationAutofill).toBe(false);
  });
});

describe("filter catalog options", () => {
  it("labels schedule options with the stored name and appends orphaned values", () => {
    const settings = createDefaultSettings();
    settings.calendars[0].categories = [
      { id: "default", name: "Neutral", color: "#90d7ec" },
      { id: "catalog-abc", name: "Reading", color: "#65c294" },
    ];
    expect(scheduleCategoryOptions(settings, ["catalog-abc", "legacy-value"])).toEqual([
      { value: "default", label: "Neutral", color: "#90d7ec", group: "Default" },
      { value: "catalog-abc", label: "Reading", color: "#65c294", group: "Default" },
      { value: "legacy-value", label: "legacy-value", color: undefined },
    ]);
  });

  it("groups ledger options by primary category and keeps stored-only rows", () => {
    const settings = createDefaultSettings();
    settings.bill.categories = [
      { id: "expense", name: "Expense", color: "#c0392b", direction: "expense", sub: ["Daily", "Medical"] },
      { id: "income", name: "Income", color: "#2f8f5b", direction: "income", sub: ["Salary"] },
    ];
    expect(billCategoryOptions(settings, ["Expense/Medical", "legacy/old"])).toEqual([
      { value: "Expense/Daily", label: "Daily", color: "#c0392b", group: "Expense" },
      { value: "Expense/Medical", label: "Medical", color: "#c0392b", group: "Expense" },
      { value: "Income/Salary", label: "Salary", color: "#2f8f5b", group: "Income" },
      { value: "legacy/old", label: "old", color: undefined, group: "legacy" },
    ]);
  });
});
