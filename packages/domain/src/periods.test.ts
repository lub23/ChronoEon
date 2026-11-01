import { describe, expect, it } from "vitest";
import { advisorDateHints, resolveRelativePeriods } from "./stats";

describe("calendar periods named in a question resolve from the device date", () => {
  const today = "2026-11-01";

  it("maps 上个月 to the previous calendar month of the current year", () => {
    expect(resolveRelativePeriods("上个月花费多少", today)).toEqual([
      { phrase: "上个月", range: { start: "2026-10-01", end: "2026-10-31" } },
    ]);
  });

  it("crosses the year end and keeps the longer phrase when two overlap", () => {
    expect(resolveRelativePeriods("上个月", "2026-01-15")[0].range).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(resolveRelativePeriods("上上个月和上个月", today).map((period) => period.phrase)).toEqual(["上上个月", "上个月"]);
  });

  it("understands counts, bare month names and English, but not explicit years or verbs", () => {
    expect(resolveRelativePeriods("最近三天", today)[0].range).toEqual({ start: "2026-10-30", end: "2026-11-01" });
    expect(resolveRelativePeriods("10月的开销", today)[0].range).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(resolveRelativePeriods("12月的开销", today)[0].range).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(resolveRelativePeriods("how much did I spend last month", today)[0].range).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(resolveRelativePeriods("2025年10月", today)).toEqual([]);
    expect(resolveRelativePeriods("how much may I spend at the market", today)).toEqual([]);
  });

  it("writes the resolved dates into the prompt hint", () => {
    const hints = advisorDateHints(today, resolveRelativePeriods("上个月", today));
    expect(hints).toContain("last month/上个月 2026-10-01..2026-10-31");
    expect(hints).toContain('"上个月" = 2026-10-01..2026-10-31');
  });
});
