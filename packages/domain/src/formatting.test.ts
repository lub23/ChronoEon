import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "./settings";
import { useExampleCatalogs } from "./testFixtures";
import {
  billTotals,
  calendarItemDurationMinutes,
  colorWithOpacity,
  expenseIntensityPercent,
  formatBillLabel,
  formatCalendarItemTimeRange,
  formatEntryTime,
  formatExpense,
  hexToRgba,
  readableTextColor,
} from "./index";

describe("shared formatting and color projections", () => {
  it("formats list ranges with civil cross-day durations", () => {
    const item = { modality: "event" as const, begin: "2026-07-20 23:00", end: "2026-07-21 01:00" };
    expect(calendarItemDurationMinutes(item.begin, item.end)).toBe(120);
    expect(formatCalendarItemTimeRange(item, "en")).toBe("23:00-(+1)01:00(2h)");
    expect(formatCalendarItemTimeRange({ modality: "bill", begin: "2026-07-20 12:00" }, "zh")).toBe("12:00");
  });

  it.each(["en", "zh"] as const)("uses one compact time range in %s without losing minute precision or day offsets", (locale) => {
    const entry = { date: "2026-09-10", start: "10:00", end: "11:30", allDay: false };
    expect(formatEntryTime(entry, locale)).toBe("10:00-11:30(1h 30m)");
    expect(formatCalendarItemTimeRange({ begin: "2026-09-10 10:00", end: "2026-09-10 11:30" }, locale)).toBe("10:00-11:30(1h 30m)");
    expect(formatEntryTime({ ...entry, start: "23:59", end: "00:01" }, locale)).toBe("23:59-(+1)00:01(2m)");
    expect(formatEntryTime({ ...entry, endDate: "2026-09-12", end: "10:01" }, locale)).toBe("10:00-(+2)10:01(48h 1m)");
    expect(formatEntryTime({ ...entry, end: undefined }, locale)).toBe("10:00");
    expect(formatEntryTime({ ...entry, allDay: true }, locale)).toBe(locale === "zh" ? "全天" : "All day");
  });

  it("shares bill labels, totals, and bounded expense intensity", () => {
    expect(formatExpense(2_500_000)).toBe("2.5M");
    expect(formatBillLabel(-20, "￥")).toBe("￥-20");
    expect(billTotals([
      { kind: "bill", amount: 35, category: "income" },
      { kind: "bill", amount: 20, category: "food" },
    ], useExampleCatalogs(createDefaultSettings()))).toEqual({ income: 35, expense: 20 });
    expect(expenseIntensityPercent(1_000_000)).toBeLessThanOrEqual(30);
  });

  it("provides contrast-safe and alpha-safe color helpers", () => {
    expect(readableTextColor("#ffffff")).toBe("#1f2937");
    expect(readableTextColor("#111111")).toBe("#ffffff");
    expect(colorWithOpacity("#3b82f6ff", "66")).toBe("#3b82f666");
    expect(hexToRgba("#3b82f6", 0.4)).toBe("rgba(59, 130, 246, 0.4)");
  });
});
