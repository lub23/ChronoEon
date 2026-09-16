import { describe, expect, it } from "vitest";
import type { Entry } from "./entry";
import { DEFAULT_CHRONOEON_SETTINGS } from "./settings";
import { buildReview, outstandingTaskSections, outstandingTasks, previousRangeOf, reviewBuckets, reviewCategoryOptions, reviewGranularities } from "./review";

function task(id: string, date: string, status: Entry["status"] = "open", extra: Partial<Entry> = {}): Entry {
  return {
    id,
    kind: "task",
    title: `Task ${id}`,
    date,
    allDay: true,
    category: "work",
    color: "#77787b",
    status,
    createdAt: "2026-08-01T00:00:00Z",
    ...extra,
  };
}

function bill(id: string, date: string, amount: number, category = "food"): Entry {
  return {
    id,
    kind: "bill",
    title: `Bill ${id}`,
    date,
    allDay: true,
    category,
    color: "#77787b",
    amount,
    createdAt: "2026-08-01T00:00:00Z",
  };
}

const settings = DEFAULT_CHRONOEON_SETTINGS;

describe("previousRangeOf", () => {
  it("returns a same-length range immediately before the input", () => {
    expect(previousRangeOf({ start: "2026-08-10", end: "2026-08-16" })).toEqual({ start: "2026-08-03", end: "2026-08-09" });
  });

  it("handles single-day ranges", () => {
    expect(previousRangeOf({ start: "2026-08-12", end: "2026-08-12" })).toEqual({ start: "2026-08-11", end: "2026-08-11" });
  });
});

describe("reviewBuckets", () => {
  const entries = [
    bill("a", "2026-08-10", -30),
    bill("b", "2026-08-11", -20),
    bill("c", "2026-08-17", -50),
    task("t1", "2026-08-10", "done"),
    task("t2", "2026-08-11", "open"),
  ];

  it("produces one bucket per day for day granularity", () => {
    const buckets = reviewBuckets(entries, { start: "2026-08-10", end: "2026-08-12" }, "day");
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toMatchObject({ date: "2026-08-10", expense: 30, taskTotal: 1, taskDone: 1 });
    expect(buckets[1]).toMatchObject({ date: "2026-08-11", expense: 20, taskTotal: 1, taskDone: 0 });
    expect(buckets[2]).toMatchObject({ date: "2026-08-12", expense: 0, taskTotal: 0, taskDone: 0 });
  });

  it("groups by month for month granularity", () => {
    const buckets = reviewBuckets(entries, { start: "2026-08-01", end: "2026-09-30" }, "month");
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ date: "2026-08-01", expense: 100, taskTotal: 2, taskDone: 1 });
    expect(buckets[1]).toMatchObject({ date: "2026-09-01", expense: 0, taskTotal: 0, taskDone: 0 });
  });

  it("groups by year for year granularity", () => {
    const buckets = reviewBuckets(entries, { start: "2026-01-01", end: "2026-12-31" }, "year");
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ date: "2026-01-01", expense: 100, taskTotal: 2, taskDone: 1 });
  });

  it("uses category cash-flow direction, including positive-magnitude expenses", () => {
    const buckets = reviewBuckets(
      [bill("stored-magnitude", "2026-08-10", 25, "food")],
      { start: "2026-08-10", end: "2026-08-10" },
      "day",
    );
    expect(buckets[0]?.expense).toBe(25);
  });
});

describe("buildReview", () => {
  it("compares completion against the previous period and excludes cancelled work", () => {
    const entries = [
      // Previous week: 1 of 2 done -> 50%.
      task("p1", "2026-08-04", "done"),
      task("p2", "2026-08-05", "open"),
      // Current week: 2 done, 1 open, 1 cancelled -> 2/3 = 66.7%.
      task("c1", "2026-08-10", "done"),
      task("c2", "2026-08-11", "done"),
      task("c3", "2026-08-12", "open"),
      task("c4", "2026-08-13", "cancelled"),
    ];
    const review = buildReview(entries, { start: "2026-08-10", end: "2026-08-16" }, settings, "2026-08-16");
    expect(review.range).toEqual({ start: "2026-08-10", end: "2026-08-16" });
    expect(review.tasks).toMatchObject({ total: 4, done: 2, open: 1, cancelled: 1 });
    expect(Math.round(review.tasks.rate.current)).toBe(67);
    expect(Math.round(review.tasks.rate.previous)).toBe(50);
    expect(review.tasks.rate.delta).toBeGreaterThan(0);
  });

  it("reports spend against the previous period", () => {
    const entries = [bill("p", "2026-08-05", -40), bill("c1", "2026-08-11", -30), bill("c2", "2026-08-12", -25)];
    const review = buildReview(entries, { start: "2026-08-10", end: "2026-08-16" }, settings, "2026-08-16");
    expect(review.expense.current).toBe(55);
    expect(review.expense.previous).toBe(40);
    expect(review.expense.delta).toBe(15);
  });

  it("measures the completion streak ending at the range end and the best run inside it", () => {
    const entries = [
      task("a", "2026-08-10", "done"),
      task("b", "2026-08-11", "done"),
      task("c", "2026-08-12", "done"),
      // 08-13 has nothing; the run restarts and reaches the last day.
      task("d", "2026-08-14", "done"),
      task("e", "2026-08-15", "done"),
      task("f", "2026-08-16", "done"),
    ];
    const review = buildReview(entries, { start: "2026-08-10", end: "2026-08-16" }, settings, "2026-08-16");
    expect(review.streak).toBe(3);
    expect(review.bestStreak).toBe(3);
  });

  it("scopes overdue work to the selected window and today", () => {
    const entries = [
      task("old", "2026-07-30", "open"),
      task("oldDone", "2026-07-29", "done"),
      task("oldCancelled", "2026-07-28", "cancelled"),
      task("inRange", "2026-08-11", "open"),
      task("future", "2026-08-18", "open"),
    ];
    const review = buildReview(entries, { start: "2026-08-10", end: "2026-08-16" }, settings, "2026-08-16");
    expect(review.carriedOver.map((entry) => entry.id)).toEqual(["inRange"]);
  });

  it("returns all overdue work when no range is supplied", () => {
    const entries = [
      task("old", "2026-07-30", "open"),
      task("today", "2026-08-16", "open"),
      task("future", "2026-08-17", "open"),
    ];
    expect(outstandingTasks(entries, "2026-08-16").map((entry) => entry.id)).toEqual(["today", "old"]);
  });

  it("never treats an open recurring habit as overdue debt", () => {
    // A daily habit anchored years ago is not a missed deadline; without this
    // rule it would sit in "carried over" on every review, forever.
    const entries = [task("habit", "2024-01-01", "open", { recurrence: "daily" })];
    const review = buildReview(entries, { start: "2026-08-10", end: "2026-08-16" }, settings, "2026-08-16");
    expect(review.carriedOver).toEqual([]);
  });

  it("splits unfinished non-recurring work at today without duplication", () => {
    const entries = [
      task("old", "2026-08-15", "open"),
      task("today", "2026-08-16", "open"),
      task("future", "2026-08-17", "open"),
    ];
    const sections = outstandingTaskSections(entries, "2026-08-16");
    expect(sections.overdue.map((entry) => entry.id)).toEqual(["old"]);
    expect(sections.upcoming.map((entry) => entry.id)).toEqual(["today", "future"]);
  });

  it("collapses a recurring task to one recent missed occurrence and one next occurrence", () => {
    const habit = task("gym", "2026-08-10", "open", {
      recurrence: "daily",
      recurrenceExceptions: {
        "2026-08-14": { status: "done" },
      },
    });
    const sections = outstandingTaskSections([habit], "2026-08-16");
    expect(sections.overdue).toHaveLength(1);
    expect(sections.overdue[0]).toMatchObject({ recurrenceSourceId: "gym", occurrenceDate: "2026-08-15" });
    expect(sections.upcoming).toHaveLength(1);
    expect(sections.upcoming[0]).toMatchObject({ recurrenceSourceId: "gym", occurrenceDate: "2026-08-16" });
  });

  it("shows only the next occurrence when a recurring task has no missed past instance", () => {
    const habit = task("gym", "2026-08-16", "open", { recurrence: "daily" });
    const sections = outstandingTaskSections([habit], "2026-08-16");
    expect(sections.overdue).toEqual([]);
    expect(sections.upcoming).toHaveLength(1);
    expect(sections.upcoming[0]).toMatchObject({ recurrenceSourceId: "gym", occurrenceDate: "2026-08-16" });
  });

  it("returns an empty but well-formed review when nothing happened", () => {
    const review = buildReview([], { start: "2026-08-01", end: "2026-08-31" }, settings, "2026-08-31");
    expect(review.total).toBe(0);
    expect(review.tasks.rate.current).toBe(0);
    expect(review.streak).toBe(0);
  });
});

describe("weekly and category review trends", () => {
  const catalog = { ...settings,
    bill: { ...settings.bill, categories: [
      { id: "food", name: "Dining", color: "#aabbcc", direction: "expense" as const, sub: ["Meal", "Drink"] },
      { id: "income", name: "Income", color: "#ccddee", direction: "income" as const, sub: ["Salary"] },
    ] },
    calendars: settings.calendars.map(calendar => ({ ...calendar, categories: [{ id: "work", name: "Work", color: "#448866" }] })),
  };
  it.each([["2026-09-13", false], ["2026-09-14", true]] as const)("requires fourteen inclusive days for weekly curves (%s)", (end, available) => {
    expect(reviewGranularities({ start: "2026-09-01", end }).includes("week")).toBe(available);
  });
  it("does not default to a one-point month/year, including leap years", () => {
    expect(reviewGranularities({ start: "2026-08-01", end: "2026-08-31" }).at(-1)).toBe("week");
    expect(reviewGranularities({ start: "2024-01-01", end: "2024-12-31" }).at(-1)).toBe("month");
    expect(reviewGranularities({ start: "2025-09-01", end: "2026-09-01" }).at(-1)).toBe("year");
  });
  it("uses the configured first weekday and excludes records outside partial edge weeks", () => {
    const data = [bill("before", "2026-08-10", -999), bill("first", "2026-08-11", -20), bill("middle", "2026-08-17", -30), bill("last", "2026-08-24", -40), bill("after", "2026-08-25", -999)];
    const buckets = reviewBuckets(data, { start: "2026-08-11", end: "2026-08-24" }, "week", { ...settings, firstDay: 1 });
    expect(buckets.map(bucket => [bucket.date, bucket.expense])).toEqual([["2026-08-10", 20], ["2026-08-17", 30], ["2026-08-24", 40]]);
    const sunday = reviewBuckets(data, { start: "2026-08-11", end: "2026-08-24" }, "week", { ...settings, firstDay: 0 });
    expect(sunday.map(bucket => bucket.date)).toEqual(["2026-08-09", "2026-08-16", "2026-08-23"]);
  });
  it("rolls weeks over month/year boundaries and includes empty weeks", () => {
    const buckets = reviewBuckets([task("repeat", "2025-12-29", "done", { recurrence: "weekly" })], { start: "2025-12-29", end: "2026-01-18" }, "week", { ...settings, firstDay: 1 });
    expect(buckets.map(bucket => [bucket.date, bucket.taskTotal])).toEqual([["2025-12-29", 1], ["2026-01-05", 1], ["2026-01-12", 1]]);
    expect(reviewBuckets([], { start: "2026-09-07", end: "2026-09-20" }, "week")).toHaveLength(2);
  });
  it("folds subcategories/name aliases into primary curves and keeps bill direction", () => {
    const food = catalog.bill.categories.find(category => category.id === "food")!;
    const income = catalog.bill.categories.find(category => category.direction === "income")!;
    const data = [bill("meal", "2026-08-10", 25, "food/Meal"), bill("drink", "2026-08-10", 15, food.name + "/Drink"), bill("salary", "2026-08-10", 100, income.name + "/Salary")];
    const bucket = reviewBuckets(data, { start: "2026-08-10", end: "2026-08-10" }, "day", catalog)[0];
    expect(bucket.billCategories[food.id]).toBe(-40); expect(bucket.billCategories[income.id]).toBe(100);
    expect(bucket.billTotal).toBe(60); expect(bucket.expense).toBe(40);
    expect(bucket.billIncome).toBe(100);
    expect(Object.values(bucket.billCategories).reduce((sum, value) => sum + value, 0)).toBe(bucket.billTotal);
    const options = reviewCategoryOptions(data, "bill", catalog);
    expect(options.filter(option => option.value === food.id)).toHaveLength(1);
    expect(options.some(option => option.value.includes("/"))).toBe(false);
    expect(options.find(option => option.value === food.id)?.color).toBe(food.color);
  });
  it("includes events and tasks in schedule curves but not bills or unscheduled ideas", () => {
    const work = catalog.calendars.flatMap(calendar => calendar.categories).find(category => category.id === "work")!;
    const data = [task("task", "2026-08-10"), task("event", "2026-08-10", "open", { kind: "event", category: work.name + "/Project" }),
      task("idea", "2026-08-10", "open", { kind: "idea" }), bill("bill", "2026-08-10", -5)];
    const bucket = reviewBuckets(data, { start: "2026-08-10", end: "2026-08-10" }, "day", catalog)[0];
    expect(bucket.scheduleTotal).toBe(2); expect(bucket.taskTotal).toBe(1);
    expect(bucket.scheduleCategories.work).toBe(2);
    expect(reviewCategoryOptions(data, "schedule", catalog).find(option => option.value === "work")?.color).toBe(work.color);
  });
});
