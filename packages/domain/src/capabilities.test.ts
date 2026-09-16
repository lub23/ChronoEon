import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "./settings";
import { useExampleCatalogs } from "./testFixtures";
import {
  DEFAULT_CHRONOEON_SETTINGS,
  aggregateBillStats,
  aggregateTaskStats,
  collectTags,
  createTimerSession,
  dueReminders,
  entriesInRange,
  entryDurationMinutes,
  expenseHeatmap,
  finalizeTimerSegments,
  formatTimerDuration,
  isSafeAttachmentPath,
  keywordStats,
  normalizeAttachmentPath,
  partitionAttachments,
  pauseTimerSession,
  recoverTimerSession,
  resolveAttachmentPath,
  resolveReminderTime,
  resumeTimerSession,
  statsPresetRange,
  timerElapsedMs,
  timerSessionToDraft,
  updateTimerSession,
  type Entry
} from "./index";

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "kind" | "date">): Entry {
  return {
    title: overrides.title ?? "Entry",
    category: "work",
    color: "#777777",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  } as Entry;
}

describe("reminders", () => {
  it("resolves relative reminders against the local begin time", () => {
    const trigger = resolveReminderTime({ date: "2026-07-27", start: "09:30", reminder: "15min" });
    expect(trigger).not.toBeNull();
    expect(trigger?.getHours()).toBe(9);
    expect(trigger?.getMinutes()).toBe(15);
  });

  it("resolves anchored reminders on the surrounding civil day", () => {
    const previous = resolveReminderTime({ date: "2026-07-27", allDay: true, reminder: "day-before-9am" });
    expect(previous?.getDate()).toBe(26);
    expect(previous?.getHours()).toBe(9);
    expect(resolveReminderTime({ date: "2026-07-27", reminder: "none" })).toBeNull();
  });

  it("surfaces a reminder once inside the grace window and skips finished tasks", () => {
    const entries = [
      entry({ id: "a", kind: "event", date: "2026-07-27", start: "10:00", reminder: "at-time" }),
      entry({ id: "b", kind: "task", date: "2026-07-27", start: "10:00", reminder: "at-time", status: "done" })
    ];
    const now = new Date(2026, 6, 27, 10, 5, 0);
    const due = dueReminders(entries, { now });
    expect(due.map((item) => item.entry.id)).toEqual(["a"]);
    expect(dueReminders(entries, { now: new Date(2026, 6, 27, 11, 0, 0) })).toHaveLength(0);
  });

  it("expands recurring series so every occurrence gets its own reminder key", () => {
    const series = entry({
      id: "series",
      kind: "event",
      date: "2026-07-20",
      start: "08:00",
      reminder: "at-time",
      recurrence: "daily"
    });
    const due = dueReminders([series], { now: new Date(2026, 6, 27, 8, 1, 0) });
    expect(due).toHaveLength(1);
    expect(due[0].key).toContain("2026-07-27");
  });
});

describe("live timer", () => {
  it("accumulates paused segments without counting the pause", () => {
    let session = createTimerSession({ title: "Focus", calendarId: "default" }, 1_000);
    session = pauseTimerSession(session, 61_000);
    expect(timerElapsedMs(session, 500_000)).toBe(60_000);
    session = resumeTimerSession(session, 100_000);
    expect(timerElapsedMs(session, 130_000)).toBe(90_000);
  });

  it("caps an interrupted segment at the last heartbeat on recovery", () => {
    const session = { ...createTimerSession({ title: "Focus", calendarId: "default" }, 0), lastTick: 30_000 };
    const recovery = recoverTimerSession(session, 10 * 60_000);
    expect(recovery.recovered).toBe(true);
    expect(timerElapsedMs(recovery.session, 10 * 60_000)).toBe(30_000);
  });

  it("drops sub-second noise and builds a draft covering the whole span", () => {
    const start = new Date(2026, 6, 27, 9, 0, 0).getTime();
    let session = createTimerSession({ title: "Deep work", calendarId: "default", kind: "event" }, start);
    session = pauseTimerSession(session, start + 30 * 60_000);
    session = resumeTimerSession(session, start + 45 * 60_000);
    const segments = finalizeTimerSegments(session, start + 60 * 60_000);
    expect(segments).toHaveLength(2);
    const draft = timerSessionToDraft(session, segments, "Untitled");
    expect(draft?.date).toBe("2026-07-27");
    expect(draft?.start).toBe("09:00");
    expect(draft?.end).toBe("10:00");
    expect(draft?.note).toContain("45:00");
  });

  it("carries category, location, note and photos into the draft", () => {
    const start = new Date(2026, 8, 9, 9, 30, 0).getTime();
    const session = createTimerSession({ title: "Reading", calendarId: "default", category: "study", location: "Library", note: "Chapter 3", images: ["attachments/a.webp"] }, start);
    const segments = finalizeTimerSegments(session, start + 5 * 60_000);
    const draft = timerSessionToDraft(session, segments, "Untitled");
    expect(draft?.category).toBe("study");
    expect(draft?.location).toBe("Library");
    expect(draft?.images).toEqual(["attachments/a.webp"]);
    expect(draft?.note).toBe(["Chapter 3", "⏱ 5:00"].join("\n"));
  });

  it("updates details on a running session without touching its segments", () => {
    const session = createTimerSession({ title: "Reading", calendarId: "default", category: "study" }, 1_000);
    const updated = updateTimerSession(session, { note: "later", images: ["attachments/b.webp"], location: "Home" });
    expect(updated.segments).toBe(session.segments);
    expect(updated).toMatchObject({ note: "later", images: ["attachments/b.webp"], location: "Home", category: "study" });
    expect(timerSessionToDraft(updated, finalizeTimerSegments(updated, 61_000), "x")?.note).toBe(["later", "⏱ 1:00"].join("\n"));
  });

  it("formats durations with an hour part only when needed", () => {
    expect(formatTimerDuration(59_000)).toBe("0:59");
    expect(formatTimerDuration(3_661_000)).toBe("1:01:01");
  });
});

describe("statistics", () => {
  // Ledger direction is read from the configured catalog, so these cases need
  // a catalog with an income group rather than the single shipped default.
  const settings = useExampleCatalogs(createDefaultSettings());
  const bills: Entry[] = [
    entry({ id: "salary", kind: "bill", date: "2026-07-01", category: "Income/Salary", amount: 10_000 }),
    entry({ id: "lunch", kind: "bill", date: "2026-07-02", category: "Expense/Daily", amount: -50 }),
    entry({ id: "dinner", kind: "bill", date: "2026-07-02", category: "Expense/Daily", amount: -150 }),
    entry({ id: "medical", kind: "bill", date: "2026-07-03", category: "Expense/Medical", amount: -100 }),
    entry({ id: "misc", kind: "bill", date: "2026-07-03", category: "其他/杂项", amount: -20 })
  ];

  it("splits income and expense and ranks categories by absolute total", () => {
    const stats = aggregateBillStats(bills, { start: "2026-07-01", end: "2026-07-31" }, settings);
    expect(stats.income).toBe(10_000);
    expect(stats.expense).toBe(320);
    expect(stats.balance).toBe(9_680);
    expect(stats.categories[0].id).toBe("income");
    expect(stats.categories.map((category) => category.name)).toEqual(["Income", "Expense", "其他"]);
    const expense = stats.categories.find((category) => category.name === "Expense");
    expect(expense?.sub.map((item) => item.name)).toEqual(["Daily", "Medical"]);
  });

  it("measures task completion and per-category duration", () => {
    const entries: Entry[] = [
      entry({ id: "t1", kind: "task", date: "2026-07-27", start: "09:00", end: "10:30", status: "done" }),
      entry({ id: "t2", kind: "task", date: "2026-07-27", start: "11:00", end: "11:30", status: "open" }),
      entry({ id: "e1", kind: "event", date: "2026-07-27", start: "14:00", end: "15:00" })
    ];
    const stats = aggregateTaskStats(entries, { start: "2026-07-27", end: "2026-07-27" });
    expect(stats.total).toBe(2);
    expect(stats.done).toBe(1);
    expect(Math.round(stats.rate)).toBe(50);
    expect(stats.totalMinutes).toBe(180);
    expect(stats.longestMinutes).toBe(90);
    expect(stats.categories[0].count).toBe(3);
  });

  it("counts a cross-day entry once and measures its full span", () => {
    const overnight = entry({ id: "night", kind: "event", date: "2026-07-27", start: "22:00", end: "02:00", endDate: "2026-07-28" });
    expect(entryDurationMinutes(overnight)).toBe(240);
    expect(entriesInRange([overnight], { start: "2026-07-27", end: "2026-07-28" })).toHaveLength(1);
  });

  it("builds a full-year expense heatmap of complete weeks", () => {
    const heatmap = expenseHeatmap(bills, 2026, 1, settings);
    expect(heatmap.total).toBe(320);
    expect(heatmap.maxDay).toBe(200);
    expect(heatmap.weeks.every((week) => week.length === 7)).toBe(true);
    expect(heatmap.monthLabels.length).toBeGreaterThan(0);
  });

  it("computes keyword and tag analytics over the visible fields", () => {
    const entries: Entry[] = [
      entry({ id: "a", kind: "bill", date: "2026-07-02", amount: -50, tags: ["food"], title: "Lunch" }),
      entry({ id: "b", kind: "task", date: "2026-07-02", title: "Write report", start: "09:00", end: "10:00" })
    ];
    const range = { start: "2026-07-01", end: "2026-07-31" };
    expect(keywordStats(entries, range, "#food").entries.map((item) => item.id)).toEqual(["a"]);
    expect(keywordStats(entries, range, "report").totalMinutes).toBe(60);
    expect(keywordStats(entries, range, "").entries).toHaveLength(0);
    expect(collectTags(entries)).toEqual([{ tag: "food", count: 1 }]);
  });

  it("resolves shared range presets", () => {
    expect(statsPresetRange("7d", "2026-07-27")).toEqual({ start: "2026-07-21", end: "2026-07-27" });
    expect(statsPresetRange("this_month", "2026-07-27")).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(statsPresetRange("this_year", "2026-07-27")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(statsPresetRange("this_week", "2026-07-27", 1).start).toBe("2026-07-27");
  });
});

describe("attachments", () => {
  it("refuses every path that could escape the vault", () => {
    expect(isSafeAttachmentPath("ChronoEon/attachments/a.png")).toBe(true);
    expect(isSafeAttachmentPath("../../etc/passwd")).toBe(false);
    expect(isSafeAttachmentPath("/etc/passwd")).toBe(false);
    expect(isSafeAttachmentPath("C:\\Users\\me\\a.png")).toBe(false);
    expect(isSafeAttachmentPath("file:///etc/passwd")).toBe(false);
    expect(isSafeAttachmentPath("https://example.com/a.png")).toBe(false);
    expect(isSafeAttachmentPath("   ")).toBe(false);
  });

  it("normalizes separators and reports why a path was refused", () => {
    expect(normalizeAttachmentPath("ChronoEon\\attachments\\.\\a.png")).toEqual({ path: "ChronoEon/attachments/a.png" });
    expect(normalizeAttachmentPath("a/../../b")).toEqual({ issue: { path: "a/../../b", reason: "escapes-vault" } });
  });

  it("joins a vault root only for validated relative paths", () => {
    expect(resolveAttachmentPath("/home/me/vault/", "ChronoEon/attachments/a.png")).toBe("/home/me/vault/ChronoEon/attachments/a.png");
    expect(resolveAttachmentPath("/home/me/vault", "../secret")).toBeNull();
  });

  it("deduplicates safe paths and separates rejected ones", () => {
    const result = partitionAttachments(["a/b.png", "a/b.png", "/tmp/c.png"]);
    expect(result.safe).toEqual(["a/b.png"]);
    expect(result.rejected).toHaveLength(1);
  });
});
