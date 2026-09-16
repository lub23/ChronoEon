import type { Entry } from "@chronoeon/domain";

/** Multi-select entry filter (categories, calendars, photo appreciation). */
export interface EntryFilter {
  /** null = all categories (including new ones); [] = none selected. */
  categories: string[] | null;
  /** Ledger categories are independent, even when labels match schedule ones. */
  billCategories: string[] | null;
  /** Empty = all calendars. */
  calendarIds: string[];
  /**
   * Photo appreciation mode: every item chip is hidden so only the photos
   * recorded on the visible days remain. The entries themselves stay in the
   * day lists, because the photos are read from them.
   */
  photosOnly: boolean;
}

export const EMPTY_ENTRY_FILTER: EntryFilter = { categories: null, billCategories: null, calendarIds: [], photosOnly: false };

export function filterActive(filter: EntryFilter): boolean {
  return filter.categories !== null
    || filter.billCategories !== null
    || filter.calendarIds.length > 0
    || filter.photosOnly;
}

export function entryMatchesFilter(entry: Entry, filter: EntryFilter): boolean {
  const categories = entry.kind === "bill" ? filter.billCategories : filter.categories;
  if (categories !== null && !categories.includes(entry.category)) return false;
  if (filter.calendarIds.length && !filter.calendarIds.includes(entry.calendar ?? "default")) return false;
  return true;
}

/** Toggle membership in a copied array (multi-select chip helper). */
export function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
