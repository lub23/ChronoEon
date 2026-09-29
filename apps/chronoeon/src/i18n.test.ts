import { describe, expect, it } from "vitest";
import { calendarDisplayName, catalogLabel, categoryLabel, compositeCategoryLabel, t } from "./i18n";
import { createDefaultSettings } from "@chronoeon/domain";

describe("standalone localization", () => {
  it("uses the requested bilingual ChronoEon motto", () => {
    expect(t("productTagline", "zh")).toBe("时秉元德，岁载玄黄");
    expect(t("productTagline", "en")).toBe("Grace in time, worlds in years");
  });

  it("keeps settings and transfer actions available in both locales", () => {
    for (const key of ["settings", "settingsGeneral", "settingsCalendar", "settingsData", "exportEntries", "importSettings", "clearSearch"] as const) {
      expect(t(key, "zh")).not.toBe("");
      expect(t(key, "en")).not.toBe("");
      expect(t(key, "zh")).not.toBe(t(key, "en"));
    }
  });

  it("treats catalog names as user-owned data", () => {
    expect(calendarDisplayName("Default", "zh")).toBe("默认");
    expect(calendarDisplayName("Custom calendar", "zh")).toBe("Custom calendar");
    expect(compositeCategoryLabel("收入/工资", "en")).toBe("工资");
    expect(compositeCategoryLabel("收入/工资", "zh")).toBe("工资");
    expect(catalogLabel("Team budget", "zh")).toBe("Team budget");
  });

  it("resolves stable bill IDs without translating same-name imported catalogs", () => {
    const settings = createDefaultSettings();
    settings.bill.categories.push({ id: "ledger-income", name: "Income", color: "#aaa", direction: "expense", sub: ["Salary"] });
    settings.bill.categories.push({ id: "ledger-other", name: "其他收入", color: "#bbb", direction: "income", sub: [] });
    expect(categoryLabel("income", "zh", undefined, settings)).toBe("收入");
    expect(catalogLabel("income", "en", undefined, settings)).toBe("Income");
    expect(categoryLabel("ledger-income", "zh", undefined, settings)).toBe("Income");
    expect(compositeCategoryLabel("income/Salary", "zh", settings)).toBe("工资");
    expect(compositeCategoryLabel("ledger-income/Salary", "zh", settings)).toBe("Salary");
    for (const locale of ["en", "zh"] as const) {
      expect(categoryLabel("ledger-other", locale, undefined, settings)).toBe("其他收入");
      expect(compositeCategoryLabel("ledger-other", locale, settings)).toBe("其他收入");
    }
    const chinese = createDefaultSettings("zh");
    expect(categoryLabel("income", "en", undefined, chinese)).toBe("Income");
    expect(compositeCategoryLabel("income/工资", "en", chinese)).toBe("Salary");
    chinese.bill.categories[0].name = "家用收入";
    expect(catalogLabel("income", "en", undefined, chinese)).toBe("家用收入");
    expect(compositeCategoryLabel("income/额外收入", "en", chinese)).toBe("额外收入");
  });

  it("keeps the two composers' labels short and balanced", () => {
    // Equal-ish lengths keep the header switch from looking lopsided.
    expect(t("quickNote", "en")).toBe("Note");
    expect(t("aiChatTitle", "en")).toBe("Ask");
    // The manual form says what it does in one word.
    expect(t("createTitle", "en")).toBe("New");
    expect(t("newEntry", "en")).toBe("New");
    expect(t("save", "en")).toBe("Save");
  });
});
