import { describe, expect, it } from "vitest";
import { askPresets, askPresetToolPlan } from "./askPresets";

describe("Ask preset tool plans", () => {
  it("gives every localized preset a deterministic local retrieval plan", () => {
    for (const locale of ["zh", "en"] as const) {
      const presets = askPresets(locale);
      expect(presets).toHaveLength(10);
      for (const preset of presets) {
        const plan = askPresetToolPlan(preset.prompt, locale, "2026-09-21");
        expect(plan?.id).toBe(preset.id);
        expect(plan?.calls.length).toBeGreaterThan(0);
      }
    }
  });

  it("plans focused ranges and comparisons instead of open-ended retrieval", () => {
    const prompt = (id: string) => askPresets("zh").find((preset) => preset.id === id)!.prompt;
    const weekly = askPresetToolPlan(prompt("weeklyReview"), "zh", "2026-09-21")!;
    expect(weekly.calls.map((call) => call.tool)).toEqual(["search_entries", "overdue_tasks", "upcoming_tasks"]);
    expect(weekly.calls[0].arguments).toEqual({ start_date: "2026-09-15", end_date: "2026-09-21" });

    const drift = askPresetToolPlan(prompt("spendingDrift"), "zh", "2026-09-21")!;
    expect(drift.calls.map((call) => call.tool)).toEqual(["spending_summary", "spending_summary"]);
    expect(drift.calls.map((call) => call.arguments)).toEqual([
      { start_date: "2026-08-23", end_date: "2026-09-21" },
      { start_date: "2026-07-24", end_date: "2026-08-22" },
    ]);

    const diet = askPresetToolPlan(prompt("dietPattern"), "zh", "2026-09-21")!;
    expect(diet.calls[0].arguments).toEqual({
      query: "breakfast lunch dinner snack supper 早餐 午餐 晚餐 下午茶 夜宵",
      start_date: "2026-09-08",
      end_date: "2026-09-21",
      kinds: ["event"],
    });
  });

  it("does not turn an arbitrary question into a preset plan", () => {
    expect(askPresetToolPlan("随便问一下明天的安排", "zh", "2026-09-21")).toBeNull();
  });
});
