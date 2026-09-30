import { describe, expect, it } from "vitest";
import { billCategoryForValue, billCategoryOptions, billDirectionForCategory, categoryOptionsForKind, createDefaultSettings, defaultCategoryForKind, localizeBuiltinSettings, newCalendarCatalogs, normalizeChronoEonSettings, resolveEntryColor, scheduleCategoryOptions } from "./settings";
import { aggregateBillStats } from "./stats";
import { reviewBuckets } from "./review";
import type { Entry } from "./entry";

describe("category catalogs", () => {
  it("ships a default schedule catalog and neutral example bill catalog", () => {
    const english = createDefaultSettings();
    expect(english.locationAutofill).toBe(true);
    expect(english.calendars[0].categories).toEqual([{ id: "default", name: "Default", color: "#90d7ec", builtin: true, builtinKey: "default" }]);
    expect(english.calendars[0].defaultCategoryId).toBe("default");
    expect(english.calendars[0].billCategories).toEqual([
      { id: "income", name: "Income", color: "#2f8f5b", direction: "income", sub: ["Salary", "Bonus"], builtin: true, builtinKey: "income", builtinSubKeys: ["salary", "bonus"] },
      { id: "expense", name: "Expense", color: "#c0392b", direction: "expense", sub: ["Daily", "Medical"], builtin: true, builtinKey: "expense", builtinSubKeys: ["daily", "medical"] },
    ]);
    expect(english.calendars[0].defaultBillCategoryId).toBe("income");
    expect(english.calendars[0].defaultBillSubCategoryId).toBe("Salary");

    const chinese = createDefaultSettings("zh");
    expect(chinese.calendars[0].categories[0].name).toBe("默认分类");
    expect(chinese.calendars[0].billCategories[0].name).toBe("收入");
    expect(chinese.calendars[0].billCategories[0].sub).toEqual(["工资", "奖金"]);
    expect(chinese.calendars[0].billCategories[1].name).toBe("消费");
    expect(chinese.calendars[0].billCategories[1].sub).toEqual(["日常", "医疗"]);
    expect(chinese.calendars[0].defaultBillSubCategoryId).toBe("工资");
    expect(chinese.calendars[0].defaultPaymentMethodId).toBe("bank-card");
    expect(chinese.calendars[0].itemCategories.map(category => category.name)).toContain("电子产品");
  });

  it("preserves custom asset categories and their default", () => {
    const settings = normalizeChronoEonSettings({
      calendars: [{
        id: "default",
        name: "Default",
        itemCategories: [
          { id: "electronics", name: "Devices" },
          { id: "catalog-camera", name: "Cameras", color: "#123456", icon: "electronics" },
        ],
        defaultItemCategoryId: "catalog-camera",
      }],
    });
    expect(settings.calendars[0].itemCategories).toEqual([
      { id: "electronics", name: "Devices", color: "#afb4db", icon: "electronics" },
      { id: "catalog-camera", name: "Cameras", color: "#123456", icon: "electronics" },
    ]);
    expect(settings.calendars[0].defaultItemCategoryId).toBe("catalog-camera");
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
    expect(settings.calendars[0].billCategories).toEqual([{ id: "default", name: "Example", color: "#ea66a6", direction: "expense", sub: ["Sample"] }]);
  });

  it("falls back to one default category when a catalog is empty or damaged", () => {
    const settings = normalizeChronoEonSettings({
      calendars: [{ id: "default", name: "Default", categories: [], defaultCategoryId: "gone" }],
      bill: { categories: [{ id: 5 }], defaultCategoryId: "gone" },
    });
    expect(settings.calendars[0].categories).toHaveLength(1);
    expect(settings.calendars[0].defaultCategoryId).toBe(settings.calendars[0].categories[0].id);
    expect(settings.calendars[0].billCategories).toHaveLength(2);
  });

  it("keeps the user's location-autofill choice", () => {
    expect(normalizeChronoEonSettings({ locationAutofill: false }).locationAutofill).toBe(false);
  });

  it("localizes untouched built-ins and freezes a renamed option", () => {
    const settings = createDefaultSettings("zh");
    const chinese = localizeBuiltinSettings(settings, "zh");
    expect(chinese.calendars[0].paymentMethods.map(method => method.name)).toEqual(["银行卡", "现金"]);
    expect(chinese.calendars[0].itemCategories.map(category => category.name)).toEqual(["电子产品", "其他物品"]);

    const frozen = structuredClone(settings);
    frozen.calendars[0].paymentMethods[0] = { ...frozen.calendars[0].paymentMethods[0], name: "我的卡", builtin: false };
    frozen.calendars[0].itemCategories[1] = { ...frozen.calendars[0].itemCategories[1], name: "杂物", builtin: false };
    const english = localizeBuiltinSettings(frozen, "en");
    expect(english.calendars[0].paymentMethods.map(method => method.name)).toEqual(["我的卡", "Cash"]);
    expect(english.calendars[0].itemCategories.map(category => category.name)).toEqual(["Electronics", "杂物"]);
  });

  it("localizes untouched legacy English payment and item catalogs in Chinese mode", () => {
    const settings = normalizeChronoEonSettings({
      language: "zh",
      paymentMethods: ["Bank Card", "Cash", "My Card"],
      itemCategories: [
        { id: "electronics", name: "Electronics" },
        { id: "other", name: "Other" },
        { id: "custom", name: "My Gear" },
      ],
    });
    expect(settings.calendars[0].paymentMethods.map(method => method.name)).toEqual(["银行卡", "现金", "My Card"]);
    expect(settings.calendars[0].itemCategories.map(category => category.name)).toEqual(["电子产品", "其他物品", "My Gear"]);
  });

  it("localizes every untouched shipped item category in any calendar", () => {
    const settings = normalizeChronoEonSettings({
      language: "zh",
      itemCategories: [
        { id: "electronics", name: "Electronics", builtin: true, builtinKey: "electronics" },
        { id: "clothing", name: "Clothing", builtin: true, builtinKey: "clothing" },
        { id: "home", name: "Home", builtin: true, builtinKey: "home" },
        { id: "transport", name: "Transport", builtin: true, builtinKey: "transport" },
        { id: "hobby", name: "Hobbies", builtin: true, builtinKey: "hobby" },
        { id: "other", name: "Other", builtin: true, builtinKey: "other" },
      ],
    });
    expect(settings.calendars[0].itemCategories.map(category => category.name)).toEqual([
      "电子产品", "衣物", "家居用品", "交通工具", "兴趣爱好", "其他物品",
    ]);
  });

  it("seeds every new calendar with independent task, bill, payment and item catalogs", () => {
    const catalogs = newCalendarCatalogs("en", "example");
    expect(catalogs.taskCategories[0].id).not.toBe("default");
    expect(catalogs.billCategories[0].id).not.toBe("income");
    expect(catalogs.paymentMethods.map(method => method.name)).toEqual(["Bank Card", "Cash"]);
    expect(catalogs.itemCategories.map(category => category.name)).toEqual(["Electronics", "Other"]);
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

  it("keeps identical built-in and imported names independently selectable without changing catalogs", () => {
    const settings = createDefaultSettings();
    const builtin = structuredClone(settings.calendars[0].billCategories);
    settings.calendars[0].billCategories.push({ id: "ledger-income", name: "Income", color: "#123456", direction: "expense", sub: ["Salary"] });
    settings.calendars[0].billCategories.push({ id: "ledger-expense", name: "Expense", color: "#654321", direction: "expense", sub: [] });
    const options = billCategoryOptions(settings, ["ledger-income/Old sub", "Income/Old sub"]);
    expect(options.map((option) => option.value)).toEqual([
      "income/Salary", "income/Bonus", "expense/Daily", "expense/Medical", "ledger-income/Salary", "ledger-expense", "ledger-income/Old sub", "Income/Old sub",
    ]);
    expect(options.find((option) => option.value === "ledger-expense")).toMatchObject({ label: "Expense", group: "Expense" });
    expect(options.find((option) => option.value === "ledger-income/Old sub")).toMatchObject({ label: "Old sub", group: "Income", color: "#123456" });
    expect(categoryOptionsForKind("bill", settings)).toEqual(billCategoryOptions(settings));
    expect(defaultCategoryForKind("bill", settings)).toBe("income/Salary");
    settings.calendars[0].defaultBillCategoryId = "ledger-expense";
    expect(defaultCategoryForKind("bill", settings)).toBe("ledger-expense");
    expect(settings.calendars[0].billCategories.slice(0, 2)).toEqual(builtin);
  });

  it("prioritizes IDs over same-name aliases for direction, color and separate aggregates", () => {
    const settings = createDefaultSettings();
    settings.calendars[0].billCategories.unshift({ id: "ledger-income", name: "Income", color: "#123456", direction: "expense", sub: ["Salary"] });
    expect(billCategoryForValue("income/Salary", settings)?.id).toBe("income");
    expect(billDirectionForCategory("income/Salary", settings)).toBe("income");
    expect(billDirectionForCategory("ledger-income/Salary", settings)).toBe("expense");
    expect(resolveEntryColor("income/Salary", "bill", settings)).toBe("#2f8f5b");
    expect(resolveEntryColor("ledger-income/Salary", "bill", settings)).toBe("#123456");
    const bills: Entry[] = ["income/Salary", "ledger-income/Salary"].map((category, index) => ({
      id: String(index), kind: "bill", category, amount: (index + 1) * 100, title: "Bill", date: "2026-09-01", color: "#aaa", createdAt: "2026-09-01T00:00:00Z",
    }));
    const stats = aggregateBillStats(bills, { start: "2026-09-01", end: "2026-09-30" }, settings);
    expect(stats).toMatchObject({ income: 100, expense: 200, balance: -100 });
    expect(stats.categories.map(({ id, name, total }) => ({ id, name, total }))).toEqual([
      { id: "income", name: "Income", total: 100 }, { id: "ledger-income", name: "Income", total: -200 },
    ]);
    settings.calendars[0].billCategories.push(settings.calendars[0].billCategories.shift()!);
    const buckets = reviewBuckets(bills, { start: "2026-09-01", end: "2026-09-01" }, "day", settings);
    expect(buckets[0].billCategories).toEqual({ income: 100, "ledger-income": -200 });
  });

  it("groups ledger options by primary category and keeps stored-only rows", () => {
    const settings = createDefaultSettings();
    settings.calendars[0].billCategories = [
      { id: "expense", name: "Expense", color: "#c0392b", direction: "expense", sub: ["Daily", "Medical"] },
      { id: "income", name: "Income", color: "#2f8f5b", direction: "income", sub: ["Salary"] },
    ];
    expect(billCategoryOptions(settings, ["expense/Medical", "legacy/old"])).toEqual([
      { value: "expense/Daily", label: "Daily", color: "#c0392b", group: "Expense" },
      { value: "expense/Medical", label: "Medical", color: "#c0392b", group: "Expense" },
      { value: "income/Salary", label: "Salary", color: "#2f8f5b", group: "Income" },
      { value: "legacy/old", label: "old", color: undefined, group: "legacy" },
    ]);
  });
});
