import { categoryLabel, localeTag, paymentMethodLabel } from "../i18n";
import { titleFor, type Entry, type Locale } from "./entry";

export type SearchField = "Title" | "Location" | "Note" | "Category" | "Tag" | "Payment";
export interface SearchMatch { field: SearchField; text: string; needle: string }

/** Search the same visible text everywhere, and retain its source for previews. */
export function entrySearchMatches(entry: Entry, search: string, locale: Locale): SearchMatch[] {
  const needle = search.trim().toLocaleLowerCase(localeTag[locale]);
  if (!needle) return [];
  const tagOnly = needle.startsWith("#");
  const query = tagOnly ? needle.slice(1) : needle;
  const fields: Array<[SearchField, string | undefined]> = tagOnly ? [] : [
    ["Title", titleFor(entry, locale)], ["Title", entry.title], ["Title", entry.titleZh],
    ["Location", entry.location], ["Note", entry.note],
    ["Category", categoryLabel(entry.category, locale)], ["Category", entry.category],
    ["Payment", entry.payment ? paymentMethodLabel(entry.payment, locale) : undefined],
  ];
  fields.push(...(entry.tags ?? []).map((tag): [SearchField, string] => ["Tag", tag.replace(/^#/, "")]));
  const seen = new Set<string>();
  return fields.flatMap(([field, value]) => {
    const text = value?.replace(/\s+/g, " ").trim();
    const key = field + ":" + text;
    if (!text || !text.toLocaleLowerCase(localeTag[locale]).includes(query) || seen.has(key)) return [];
    seen.add(key);
    return [{ field, text, needle: query }];
  });
}

export function entryMatchesSearch(entry: Entry, search: string, locale: Locale): boolean {
  return !search.trim() || entrySearchMatches(entry, search, locale).length > 0;
}

/** Bound long notes around the first hit, never truncate away the keyword. */
export function searchExcerpt(text: string, needle: string, locale: Locale, maxLength = 104): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const index = clean.toLocaleLowerCase(localeTag[locale]).indexOf(needle.toLocaleLowerCase(localeTag[locale]));
  const start = Math.max(0, index - 24);
  const end = Math.min(clean.length, Math.max(start + maxLength, index + needle.length + 24));
  return (start ? "…" : "") + clean.slice(start, end) + (end < clean.length ? "…" : "");
}
