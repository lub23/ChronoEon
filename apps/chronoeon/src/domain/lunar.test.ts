import { describe, expect, it } from "vitest";
import { getLunarInfo, lunarCellLabel, lunarDescription, shouldShowLunar } from "./lunar";

describe("lunar calendar", () => {
  it("resolves the lunar date for a known solar day", () => {
    const info = getLunarInfo(new Date(2026, 1, 17));
    expect(info).not.toBeNull();
    expect(info?.lunarDateStr).toMatch(/月/);
  });

  it("shows the month name on the first day of a lunar month", () => {
    // 2026-02-17 is 正月初一 (Chinese New Year).
    const info = getLunarInfo(new Date(2026, 1, 17));
    expect(info?.lunarDay).toContain("月");
    expect(lunarCellLabel(new Date(2026, 1, 17))).toBe("春节");
    expect(lunarDescription(new Date(2026, 1, 17))).toContain("春节");
  });

  it("follows the interface language by default and stays overridable", () => {
    expect(shouldShowLunar("auto", "zh")).toBe(true);
    expect(shouldShowLunar("auto", "en")).toBe(false);
    expect(shouldShowLunar("always", "en")).toBe(true);
    expect(shouldShowLunar("never", "zh")).toBe(false);
  });

  it("returns a stable label across repeated calls for the same day", () => {
    const day = new Date(2026, 6, 27);
    expect(lunarCellLabel(day)).toBe(lunarCellLabel(day));
  });
});
