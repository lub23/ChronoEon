import type { Entry, Item } from "@chronoeon/domain";
export const REPLACE_FIELDS = ["title", "titleZh", "location", "note", "category", "payment", "tags"] as const;
export type ReplaceField = typeof REPLACE_FIELDS[number];
export interface FieldReplacement { key: string; entry: Entry; field: ReplaceField; before: string; after: string; tagIndex?: number }
export interface EntryReplacement { before: Entry; after: Entry }

/** Literal, case-sensitive replacement: field values never act as patterns. */
export function replacementPreview(entries: readonly Entry[], needle: string, replacement: string, field: ReplaceField | "all" = "all"): FieldReplacement[] {
  if (!needle || needle === replacement) return [];
  return entries.flatMap(entry => REPLACE_FIELDS.filter(key => field === "all" || field === key).flatMap(key => {
    const values = key === "tags" ? entry.tags ?? [] : [entry[key]];
    return values.flatMap((value, index) => typeof value === "string" && value.includes(needle) ? [{
      key: `${entry.id}:${key}:${index}`, entry, field: key, before: value,
      after: value.split(needle).join(replacement), ...(key === "tags" ? { tagIndex: index } : {}),
    }] : []);
  }));
}
export function applyReplacements(rows: readonly FieldReplacement[]): EntryReplacement[] {
  const entries = new Map<string, EntryReplacement>();
  for (const row of rows) {
    let change = entries.get(row.entry.id);
    if (!change) { change = { before: row.entry, after: { ...row.entry } }; entries.set(row.entry.id, change); }
    if (row.field === "tags") {
      const tags = [...(change.after.tags ?? [])]; tags[row.tagIndex!] = row.after;
      change.after.tags = tags;
    } else change.after[row.field] = row.after;
  }
  for (const change of entries.values()) if (change.after.tags) change.after.tags = [...new Set(change.after.tags.filter(Boolean))];
  return [...entries.values()];
}

export type ItemReplaceField = "title" | "note" | "location" | "payment";
export interface ItemFieldReplacement { key: string; item: Item; field: ItemReplaceField; before: string; after: string }
export interface ItemReplacement { before: Item; after: Item }
export type ReplacementRow = FieldReplacement | ItemFieldReplacement;
export type ReplaceRecords = (entries: EntryReplacement[], items: ItemReplacement[]) => Promise<void>;
const itemFields = { title: "name", note: "notes", location: "location", payment: "payment" } as const;
export function itemReplacementPreview(items: readonly Item[], needle: string, replacement: string, field: ReplaceField | "all" = "all"): ItemFieldReplacement[] {
  if (!needle || needle === replacement) return [];
  return items.flatMap(item => (Object.keys(itemFields) as ItemReplaceField[]).filter(key => field === "all" || field === key).flatMap(key => {
    const value = item[itemFields[key]];
    return typeof value === "string" && value.includes(needle) ? [{key: `item:${item.id}:${key}`, item, field: key, before: value, after: value.split(needle).join(replacement)}] : [];
  }));
}
export function applyItemReplacements(rows: readonly ItemFieldReplacement[]): ItemReplacement[] {
  const items = new Map<string, ItemReplacement>();
  for (const row of rows) {
    let change = items.get(row.item.id);
    if (!change) { change = {before: row.item, after: {...row.item}}; items.set(row.item.id, change); }
    change.after[itemFields[row.field]] = row.after;
  }
  return [...items.values()];
}
