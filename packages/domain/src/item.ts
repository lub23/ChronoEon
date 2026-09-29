import { differenceInIsoDays, isIsoDate } from "./calendar";
import { createEntryId } from "./entry";

export const ITEM_CATEGORIES = ["electronics", "clothing", "home", "transport", "hobby", "other"] as const;
export type ItemCategory = typeof ITEM_CATEGORIES[number];
export type ItemAcquisition = "purchase" | "gift" | "windfall";
export type ItemDisposal = "sold" | "lost" | "discarded";

/** Owned objects have their own history; bills are optional soft references. */
export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  acquisition: ItemAcquisition;
  acquiredOn: string;
  /** Local civil time in `HH:MM`; acquired_on remains the calendar projection. */
  acquiredAt: string;
  /** Acquisition snapshot, never recomputed from a linked bill. Zero is valid. */
  cost: number;
  currency: string;
  purchaseEntryId?: string;
  disposal?: ItemDisposal;
  disposedOn?: string;
  /** Sale proceeds in the asset's currency, independent of the linked bill. */
  saleAmount?: number;
  saleEntryId?: string;
  /** Persisted images must be canonical attachments/<sha256>.webp references. */
  image?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ItemDraft = Omit<Item, "id" | "createdAt" | "updatedAt">;

/** Local edits enforce lifecycle consistency; sync retains concurrent fields. */
export function validateItemDraft(draft: ItemDraft): void {
  if (!draft.name.trim()) throw new Error("ITEM_INVALID_NAME");
  if (!ITEM_CATEGORIES.includes(draft.category)) throw new Error("ITEM_INVALID_CATEGORY");
  if (!["purchase", "gift", "windfall"].includes(draft.acquisition)) throw new Error("ASSET_INVALID_ACQUISITION");
  if (!isIsoDate(draft.acquiredOn)) throw new Error("ASSET_INVALID_ACQUIRED_ON");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.acquiredAt)) throw new Error("ASSET_INVALID_ACQUIRED_AT");
  if (!Number.isFinite(draft.cost) || draft.cost < 0) throw new Error("ASSET_INVALID_COST");
  if (!draft.currency.trim()) throw new Error("ASSET_INVALID_CURRENCY");
  if (draft.acquisition !== "purchase" && draft.purchaseEntryId !== undefined) throw new Error("ASSET_INVALID_PURCHASE_LINK");
  if (draft.disposal !== undefined) {
    if (!["sold", "lost", "discarded"].includes(draft.disposal)) throw new Error("ASSET_INVALID_DISPOSAL");
    if (!draft.disposedOn || !isIsoDate(draft.disposedOn) || draft.disposedOn < draft.acquiredOn) throw new Error("ASSET_INVALID_DISPOSED_ON");
  } else if (draft.disposedOn !== undefined) throw new Error("ASSET_INVALID_DISPOSED_ON");
  if (draft.purchaseEntryId !== undefined && draft.purchaseEntryId === draft.saleEntryId) throw new Error("ASSET_INVALID_SALE_LINK");
  if (draft.disposal !== "sold" && (draft.saleAmount !== undefined || draft.saleEntryId !== undefined)) throw new Error("ASSET_INVALID_SALE");
  if (draft.saleAmount !== undefined && (!Number.isFinite(draft.saleAmount) || draft.saleAmount < 0)) throw new Error("ASSET_INVALID_SALE_AMOUNT");
}

export function draftToItem(draft: ItemDraft): Item {
  validateItemDraft(draft);
  const now = new Date().toISOString();
  return { ...draft, name: draft.name.trim(), currency: draft.currency.trim(), notes: draft.notes?.trim() || undefined,
    id: createEntryId(), createdAt: now, updatedAt: now };
}

export function itemImageHash(image: string | undefined): string | null {
  return image?.match(/^attachments\/([0-9a-f]{64})\.webp$/)?.[1] ?? null;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Calendar days are inclusive and do not depend on DST or elapsed hours. */
export function itemDaysOwned(item: Pick<Item, "acquiredOn" | "disposal" | "disposedOn">, asOf = today()): number {
  const end = item.disposal && item.disposedOn && item.disposedOn < asOf ? item.disposedOn : asOf;
  return Math.max(1, differenceInIsoDays(end, item.acquiredOn) + 1);
}

/** The headline daily cost always uses the original acquisition cost. */
export function itemDailyCost(item: Pick<Item, "cost" | "acquiredOn" | "disposal" | "disposedOn">, asOf = today()): number {
  return item.cost / itemDaysOwned(item, asOf);
}

/** Optional separate metric; a profitable sale may produce a negative net cost. */
export function itemNetCost(item: Pick<Item, "cost" | "disposal" | "saleAmount">): number {
  return item.cost - (item.disposal === "sold" ? item.saleAmount ?? 0 : 0);
}
