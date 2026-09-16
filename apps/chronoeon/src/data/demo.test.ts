import { describe, expect, it } from "vitest";
import { createDemoEntries } from "./demo";

// The browser demo is a feature showcase: it must keep exercising every entry
// kind, status and the richer fields so the calendar, agenda and hover details
// are all visible without a real database. This guards that coverage.

const now = new Date(2026, 7, 18); // Aug 18 2026
const entries = createDemoEntries(now);

describe("demo entry set is a complete feature showcase", () => {
  it("has stable, unique ids", () => {
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("demo-"))).toBe(true);
  });

  it("covers every entry kind", () => {
    const kinds = new Set(entries.map((entry) => entry.kind));
    expect(kinds).toEqual(new Set(["task", "event", "bill", "idea"]));
  });

  it("covers every task status", () => {
    const statuses = new Set(entries.filter((entry) => entry.kind === "task").map((entry) => entry.status));
    expect(statuses).toEqual(new Set(["open", "in-progress", "done", "cancelled"]));
  });

  it("includes both timed and all-day entries, plus a cross-midnight and a multi-day span", () => {
    expect(entries.some((entry) => entry.start && !entry.allDay)).toBe(true);
    expect(entries.some((entry) => entry.allDay && !entry.endDate)).toBe(true);
    expect(entries.some((entry) => entry.endDate && entry.endDate > entry.date && entry.start)).toBe(true);
    expect(entries.some((entry) => entry.allDay && entry.endDate && entry.endDate > entry.date)).toBe(true);
  });

  it("exercises the richer fields at least once", () => {
    expect(entries.some((entry) => (entry.tags?.length ?? 0) > 0)).toBe(true);
    expect(entries.some((entry) => (entry.images?.length ?? 0) > 0)).toBe(true);
    expect(entries.some((entry) => entry.recurrence && entry.recurrence !== "none")).toBe(true);
    expect(entries.some((entry) => entry.reminder && entry.reminder !== "none")).toBe(true);
    expect(entries.some((entry) => entry.priority)).toBe(true);
    expect(entries.some((entry) => entry.urgency)).toBe(true);
    expect(entries.some((entry) => entry.location)).toBe(true);
    expect(entries.some((entry) => entry.note)).toBe(true);
    expect(entries.some((entry) => entry.calendar && entry.calendar !== "default")).toBe(true);
  });

  it("includes both an income and an expense bill", () => {
    const bills = entries.filter((entry) => entry.kind === "bill" && entry.amount !== undefined);
    expect(bills.some((entry) => (entry.amount as number) > 0)).toBe(true);
    expect(bills.some((entry) => (entry.amount as number) < 0)).toBe(true);
  });

  it("has bilingual titles", () => {
    expect(entries.every((entry) => entry.title && entry.titleZh)).toBe(true);
  });
});
