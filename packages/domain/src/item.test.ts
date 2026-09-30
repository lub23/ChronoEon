import { describe, expect, it } from "vitest";
import { itemDailyCost, itemDaysOwned, itemImageHashes, itemNetCost, draftToItem, validateItemDraft, type ItemDraft } from "./item";

const draft: ItemDraft = { name: "Camera", calendarId: "default", category: "electronics", acquisition: "purchase", acquiredOn: "2026-03-07", acquiredAt: "09:00", cost: 300, currency: "CNY" };

describe("item ownership", () => {
  it("creates stable identity and trims human input without changing snapshots", () => {
    const item = draftToItem({ ...draft, name: " Camera ", currency: " CNY ", notes: " Used daily " });
    expect(item).toMatchObject({ name: "Camera", cost: 300, currency: "CNY", notes: "Used daily" });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.updatedAt).toBe(item.createdAt);
  });

  it.each(["purchase", "gift", "windfall"] as const)("allows zero-cost %s items", (acquisition) => {
    expect(draftToItem({ ...draft, acquisition, cost: 0 }).cost).toBe(0);
  });

  it("counts inclusive calendar days across DST and leap days", () => {
    const item = draftToItem(draft);
    expect(itemDaysOwned(item, "2026-03-07")).toBe(1);
    expect(itemDaysOwned(item, "2026-03-09")).toBe(3);
    expect(itemDailyCost(item, "2026-03-09")).toBe(100);
    expect(itemDaysOwned({ ...item, acquiredOn: "2024-02-28" }, "2024-03-01")).toBe(3);
    expect(itemDaysOwned(item, "2026-03-01")).toBe(1);
  });

  it.each(["sold", "lost", "discarded"] as const)("freezes ownership days at %s disposal", (disposal) => {
    const item = { ...draft, disposal, disposedOn: "2026-03-09" };
    expect(itemDaysOwned(item, "2026-04-01")).toBe(3);
    expect(itemDailyCost(item, "2026-04-01")).toBe(100);
    expect(itemDaysOwned(item, "2026-03-08")).toBe(2);
  });

  it("does not reduce headline daily cost after a sale", () => {
    const item = { ...draft, disposal: "sold" as const, disposedOn: "2026-03-09", saleAmount: 450 };
    expect(itemDailyCost(item, "2026-04-01")).toBe(100);
    expect(itemNetCost(item)).toBe(-150);
    expect(itemNetCost(draft)).toBe(300);
  });

  it.each<Partial<ItemDraft>>([
    { name: "  " }, { acquiredOn: "2026-02-30", acquiredAt: "09:00" }, { acquiredOn: "2026-2-01", acquiredAt: "09:00" },
    { cost: -1 }, { cost: NaN }, { cost: Infinity }, { currency: " " },
    { disposal: "sold" }, { disposedOn: "2026-03-09" },
    { disposal: "lost", disposedOn: "2026-03-06" },
    { disposal: "lost", disposedOn: "2026-03-09", saleAmount: 3 },
    { disposal: "sold", disposedOn: "2026-03-09", saleAmount: -1 },
    { acquisition: "gift", purchaseEntryId: "bill" }, { saleEntryId: "bill" },
    { disposal: "sold", disposedOn: "2026-03-09", purchaseEntryId: "same", saleEntryId: "same" },
  ])("rejects invalid lifecycle data %j", (patch) => {
    expect(() => validateItemDraft({ ...draft, ...patch })).toThrow(/ITEM_INVALID_|ASSET_INVALID_/);
  });

  it("extracts canonical compressed image hashes while drafts permit demo blobs", () => {
    const hash = "a".repeat(64);
    expect(itemImageHashes([`attachments/${hash}.webp`, "blob:demo"])).toEqual([hash]);
    expect(itemImageHashes(undefined)).toEqual([]);
    const item = draftToItem({ ...draft, images: ["blob:demo", ""] });
    expect(item.images).toEqual(["blob:demo"]);
  });
});
