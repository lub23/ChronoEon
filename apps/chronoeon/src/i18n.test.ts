import { describe, expect, it } from "vitest";
import { calendarDisplayName, catalogLabel, compositeCategoryLabel, t } from "./i18n";

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
