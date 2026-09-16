import type { BillPrimaryCategory, CalendarCategory, ChronoEonSettings } from "./settings";

/**
 * Neutral test-only catalogs. The shipped app uses the default schedule
 * catalog and the example bill catalog in settings.ts; these fixtures only
 * exercise richer statistics and parsing behavior.
 */
export const EXAMPLE_TASK_CATEGORIES: CalendarCategory[] = [
  { id: "alpha", name: "Alpha", color: "#90d7ec" },
  { id: "beta", name: "Beta", color: "#f47920" },
];

export const EXAMPLE_BILL_CATEGORIES: BillPrimaryCategory[] = [
  { id: "income", name: "Income", color: "#2f8f5b", direction: "income", sub: ["Salary", "Bonus"] },
  { id: "expense", name: "Expense", color: "#c0392b", direction: "expense", sub: ["Daily", "Medical"] },
];

/** Replace a settings object's catalogs with neutral test examples, in place. */
export function useExampleCatalogs<T extends ChronoEonSettings>(settings: T): T {
  settings.calendars = settings.calendars.map((calendar, index) => index === 0
    ? { ...calendar, categories: structuredClone(EXAMPLE_TASK_CATEGORIES), defaultCategoryId: "alpha" }
    : calendar);
  settings.bill = {
    ...settings.bill,
    categories: structuredClone(EXAMPLE_BILL_CATEGORIES),
    defaultCategoryId: "income",
    defaultSubCategoryId: "Salary",
  };
  return settings;
}
