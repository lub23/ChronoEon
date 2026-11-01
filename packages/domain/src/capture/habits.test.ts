import { describe, expect, it } from "vitest";
import { buildCaptureHabits, describeCaptureHabits } from "./habits";
import type { CaptureHistoryItem } from "./index";

const lunch = (date: string): CaptureHistoryItem => ({ kind: "event", title: "午饭", category: "生活", location: "双清园", date, start: "12:00", end: "12:40" });
const breakfast = (date: string): CaptureHistoryItem => ({ kind: "event", title: "早饭", category: "生活", date, start: "07:40", end: "08:00" });
const grocery = (date: string, amount: number): CaptureHistoryItem => ({ kind: "bill", title: "买菜", category: "expense/Daily", date, amount, currency: "CNY", payment: "支付宝", tags: ["家务"] });
const history: CaptureHistoryItem[] = [
  lunch("2026-09-01"), lunch("2026-09-02"), lunch("2026-09-03"), lunch("2026-09-04"), lunch("2026-09-05"),
  breakfast("2026-09-01"), breakfast("2026-09-02"), breakfast("2026-09-03"),
  grocery("2026-09-01", -42), grocery("2026-09-02", -48), grocery("2026-09-03", -45), grocery("2026-09-04", -60),
  { kind: "task", title: "一次性任务", category: "工作", date: "2026-09-06" },
];

describe("capture habits", () => {
  it("summarises recurring titles with their usual time, place, payment and amount", () => {
    const habits = buildCaptureHabits(history);
    expect(habits.total).toBe(13);
    expect(habits.kinds[0]).toEqual({ value: "event", count: 8 });
    expect(habits.titles.find((habit) => habit.title === "午饭")).toMatchObject({
      count: 5, kind: "event", category: "生活", location: "双清园", start: "12:00", durationMinutes: 40,
    });
    expect(habits.titles.find((habit) => habit.title === "买菜")).toMatchObject({
      kind: "bill", payment: "支付宝", currency: "CNY", amount: 48, tags: ["家务"],
    });
    // A single record is not a habit.
    expect(habits.titles.some((habit) => habit.title === "一次性任务")).toBe(false);
    expect(habits.locations[0]).toEqual({ value: "双清园", count: 5 });
    expect(habits.durations.event).toBe(40);
    expect(habits.timedShare.task).toBe(0);
    expect(habits.payments[0]).toEqual({ value: "支付宝", count: 4 });
    expect(habits.currency).toBe("CNY");
  });

  it("describes the profile compactly in both languages and stays silent with little data", () => {
    expect(describeCaptureHabits(buildCaptureHabits(history.slice(0, 3)), "zh")).toBe("");
    const zh = describeCaptureHabits(buildCaptureHabits(history), "zh");
    expect(zh).toContain("午饭 → 事件/生活 · 12:00+40min · @双清园 (×5)");
    expect(zh).toContain("支付宝");
    expect(zh).toContain("任务多为全天");
    expect(zh.length).toBeLessThan(1500);
    const en = describeCaptureHabits(buildCaptureHabits(history), "en");
    expect(en).toContain("Event 62%");
    expect(en).toContain("Usual places: 双清园");
  });

  it("keeps the description inside its character budget", () => {
    const many = Array.from({ length: 200 }, (_, index) => [
      { kind: "event" as const, title: `活动${index}`, category: "生活", date: "2026-09-01", start: "10:00", end: "11:00" },
      { kind: "event" as const, title: `活动${index}`, category: "生活", date: "2026-09-02", start: "10:00", end: "11:00" },
    ]).flat();
    expect(describeCaptureHabits(buildCaptureHabits(many), "zh", 800).length).toBeLessThanOrEqual(900);
  });
});
