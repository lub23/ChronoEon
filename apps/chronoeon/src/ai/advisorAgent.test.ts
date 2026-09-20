import { describe, expect, it } from "vitest";
import type { Entry } from "../domain/entry";
import { advisorToolResultForModel, executeAdvisorToolCall } from "./advisorAgent";

function entry(id: string, partial: Partial<Entry> & Pick<Entry, "date">): Entry {
  return {
    id,
    kind: "event",
    title: "Entry",
    category: "personal",
    color: "#77787b",
    createdAt: `${partial.date}T12:00:00.000Z`,
    ...partial,
  };
}

const toolCall = (name: string, args: unknown) => ({
  id: "call-1",
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

describe("local advisor tool executor", () => {
  it("executes the model's multi-term search call across fields and dates", () => {
    const entries = [
      entry("food", { date: "2026-09-18", title: "饮食记录", note: "蔬菜沙拉" }),
      entry("sleep", { date: "2026-09-17", title: "睡眠", note: "十一点入睡" }),
      entry("work", { date: "2026-09-18", title: "Code review" }),
      entry("old", { date: "2026-08-01", title: "旧睡眠" }),
    ];
    const result = executeAdvisorToolCall(
      toolCall("search_entries", { query: "饮食 睡眠", start_date: "2026-09-13", end_date: "2026-09-19" }),
      entries,
      "2026-09-19",
    );
    expect(result.call.tool).toBe("search_entries");
    expect(result.call.range).toEqual({ start: "2026-09-13", end: "2026-09-19" });
    expect(result.entries.map((item) => item.id)).toEqual(["food", "sleep"]);
    const payload = JSON.parse(advisorToolResultForModel(result));
    expect(payload.entries.map((item: { id: string }) => item.id)).toEqual(["food", "sleep"]);
  });

  it("executes overdue and spending functions selected by the model", () => {
    const entries = [
      entry("late", { date: "2026-09-10", kind: "task", status: "open", title: "Late task" }),
      entry("bill", { date: "2026-09-18", kind: "bill", amount: 42, title: "Groceries" }),
    ];
    const overdue = executeAdvisorToolCall(toolCall("overdue_tasks", {}), entries, "2026-09-19");
    expect(overdue.entries.map((item) => item.id)).toEqual(["late"]);

    const spending = executeAdvisorToolCall(
      toolCall("spending_summary", { start_date: "2026-09-01", end_date: "2026-09-19" }),
      entries,
      "2026-09-19",
    );
    expect(spending.entries.map((item) => item.id)).toEqual(["bill"]);
    expect(spending.notes.join(" ")).toContain("expense=42.00");
  });

  it("keeps invalid model arguments read-only and explicit", () => {
    const result = executeAdvisorToolCall(
      toolCall("date_range_entries", { start_date: "not-a-date" }),
      [entry("one", { date: "2026-09-18" })],
      "2026-09-19",
    );
    expect(result.entries).toEqual([]);
    expect(result.notes).toContain("start_date and end_date are required");
  });
});
