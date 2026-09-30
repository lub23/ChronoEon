import { afterEach, describe, expect, it, vi } from "vitest";
import { createEntryId, DEFAULT_CHRONOEON_SETTINGS, draftToItem, type ItemDraft, type Entry } from "@chronoeon/domain";
import { SqliteItemStore } from "../SqliteItemStore";
import type { MemorySqliteBackend } from "../persistence/MemorySqliteBackend";
import { SyncStore } from "../sync/SyncStore";
import { openMemoryStore } from "./helpers";

const settings = DEFAULT_CHRONOEON_SETTINGS;
const opened: MemorySqliteBackend[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map((backend) => backend.close())); });
async function device() {
  const result = await openMemoryStore(); opened.push(result.backend);
  return { ...result, items: new SqliteItemStore(result.backend), sync: new SyncStore(result.backend) };
}
function item(patch: Partial<ItemDraft> = {}) {
  return draftToItem({ name: "Camera", calendarId: "default", category: "electronics", acquisition: "purchase", acquiredOn: "2026-09-01", acquiredAt: "09:00", cost: 1200, currency: "CNY", ...patch });
}
function bill(category = "expense", patch: Partial<Entry> = {}): Entry {
  return { id: createEntryId(), kind: "bill", title: "Camera bill", category, date: "2026-09-01", amount: 1200, currency: "CNY", color: "#aaaaaa", createdAt: "2026-09-01T00:00:00.000Z", ...patch };
}

describe("SQLite items", () => {
  it("lists, creates, edits, archives and reopens items without losing history", async () => {
    const d = await device();
    expect(await d.items.list()).toEqual([]);
    const listener = vi.fn(); const unsubscribe = d.items.subscribe(listener);
    const first = await d.items.save(item({ images: [`attachments/${"a".repeat(64)}.webp`], notes: "Daily" }), settings);
    const updated = await d.items.save({ ...first, name: "Updated", cost: 1300, createdAt: "2030-01-01T00:00:00Z" }, settings);
    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.updatedAt > first.updatedAt).toBe(true);
    const sold = await d.items.save({ ...updated, disposal: "sold", disposedOn: "2026-09-20", saleAmount: 800 }, settings);
    expect(await new SqliteItemStore(d.backend).list()).toEqual([sold]);
    const reopened = await d.items.save({ ...sold, disposal: undefined, disposedOn: undefined, saleAmount: undefined }, settings);
    expect(reopened.disposal).toBeUndefined();
    expect(await d.items.list()).toEqual([reopened]);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    await d.items.save({ ...reopened, notes: undefined }, settings);
    expect(listener).toHaveBeenCalledTimes(4);
    expect((await d.backend.select("SELECT * FROM attachments"))).toEqual([]);
    expect((await d.backend.select("SELECT * FROM sync_changes WHERE entity='asset'"))).toHaveLength(1);
  });

  it.each(["gift", "windfall"] as const)("persists free %s items and lost/discarded history", async (acquisition) => {
    const d = await device();
    const first = await d.items.save(item({ acquisition, cost: 0 }), settings);
    const saved = await d.items.save({ ...first, disposal: acquisition === "gift" ? "lost" : "discarded", disposedOn: "2026-09-21" }, settings);
    expect(await d.items.list()).toEqual([saved]);
  });

  it("validates links once and preserves cost/currency snapshots after bill edits/deletion", async () => {
    const d = await device();
    const purchase = await d.store.create(bill());
    const sale = await d.store.create(bill("income"));
    const first = await d.items.save(item({ purchaseEntryId: purchase.id, disposal: "sold", disposedOn: "2026-09-20", saleAmount: 600, saleEntryId: sale.id }), settings);
    await d.store.update({ ...purchase, amount: 9, currency: "USD", category: "income" });
    expect((await d.items.list())[0]).toMatchObject({ cost: 1200, currency: "CNY", saleAmount: 600 });
    await d.store.delete(purchase.id); await d.store.delete(sale.id);
    const edited = await d.items.save({ ...first, notes: "Bills deleted" }, settings);
    expect(await d.items.list()).toEqual([edited]);
    expect(edited).toMatchObject({ purchaseEntryId: purchase.id, saleEntryId: sale.id, cost: 1200, currency: "CNY" });
    const unlinked = await d.items.save({ ...edited, purchaseEntryId: undefined }, settings);
    await expect(d.items.save({ ...unlinked, purchaseEntryId: purchase.id }, settings)).rejects.toMatchObject({ code: "ItemBillNotFound" });
  });

  it("rejects missing/nonbill links and wrong cash-flow directions using current settings", async () => {
    const d = await device();
    const purchase = await d.store.create(bill()); const income = await d.store.create(bill("income"));
    const task = await d.store.create(bill("expense", { kind: "task" }));
    for (const id of [createEntryId(), task.id]) {
      await expect(d.items.save(item({ purchaseEntryId: id }), settings)).rejects.toMatchObject({ code: "ItemBillNotFound" });
    }
    await expect(d.items.save(item({ purchaseEntryId: income.id }), settings)).rejects.toMatchObject({ code: "ItemBillDirectionMismatch" });
    await expect(d.items.save(item({ disposal: "sold", disposedOn: "2026-09-20", saleEntryId: purchase.id }), settings)).rejects.toMatchObject({ code: "ItemBillDirectionMismatch" });
    const custom = structuredClone(settings);
    custom.calendars[0].billCategories = [{ id: "custom", name: "Reimbursement", color: "#aaa", sub: ["Sale"], direction: "income" }];
    const customBill = await d.store.create(bill("Reimbursement/Sale"));
    await expect(d.items.save(item({ disposal: "sold", disposedOn: "2026-09-20", saleEntryId: customBill.id }), custom)).resolves.toMatchObject({ saleEntryId: customBill.id });
  });

  it("atomically admits only one competing local binding and frees links on unlink", async () => {
    const d = await device(); const purchase = await d.store.create(bill());
    const candidates = [item({ purchaseEntryId: purchase.id }), item({ purchaseEntryId: purchase.id })];
    const results = await Promise.allSettled(candidates.map((item) => d.items.save(item, settings)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "ItemBillAlreadyLinked" } });
    const first = (await d.items.list())[0];
    await d.items.save({ ...first, purchaseEntryId: undefined }, settings);
    const other = candidates.find((item) => item.id !== first.id)!;
    expect((await d.items.save(other, settings)).purchaseEntryId).toBe(purchase.id);
    expect((await d.items.list()).filter((item) => item.purchaseEntryId === purchase.id)).toHaveLength(1);
  });

  it("also prevents another item from reusing a sale bill", async () => {
    const d = await device(); const sale = await d.store.create(bill("income"));
    const sold = { disposal: "sold" as const, disposedOn: "2026-09-20", saleEntryId: sale.id };
    await d.items.save(item(sold), settings);
    await expect(d.items.save(item(sold), settings)).rejects.toMatchObject({ code: "ItemBillAlreadyLinked" });
  });

  it("rejects invalid edits and noncanonical images before any journal write", async () => {
    const d = await device(); const first = await d.items.save(item(), settings);
    await d.sync.flush();
    for (const patch of [{ cost: -1 }, { acquiredOn: "2026-02-30", acquiredAt: "09:00" }, { disposal: "lost" as const }, { images: ["blob:demo"] }, { images: ["../../photo.webp"] }]) {
      await expect(d.items.save({ ...first, ...patch }, settings)).rejects.toMatchObject({ code: "InvalidItem" });
    }
    expect(await d.items.list()).toEqual([first]);
    expect(await d.backend.select("SELECT * FROM sync_changes")).toEqual([]);
  });

  it("rejects stale full-row saves without overwriting a newer edit or emitting changes", async () => {
    const d = await device(); const first = await d.items.save(item(), settings);
    const anotherEditor = new SqliteItemStore(d.backend);
    const latest = await anotherEditor.save({ ...first, notes: "Newer edit" }, settings);
    await d.sync.flush();
    const listener = vi.fn(); d.items.subscribe(listener);
    await expect(d.items.save({ ...first, name: "Stale editor" }, settings)).rejects.toMatchObject({ code: "RevisionMismatch" });
    expect(await d.items.list()).toEqual([latest]);
    expect(await d.backend.select("SELECT * FROM sync_changes")).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect((await d.items.save({ ...latest, name: "Refreshed editor" }, settings)).notes).toBe("Newer edit");
  });

  it("checks sale currency on a new binding but keeps existing snapshots independent", async () => {
    const d = await device();
    const sale = await d.store.create(bill("income", { currency: "USD" }));
    const draft = item({ disposal: "sold", disposedOn: "2026-09-20", saleAmount: 600, saleEntryId: sale.id });
    await expect(d.items.save(draft, settings)).rejects.toMatchObject({ code: "InvalidItem", detail: "ASSET_BILL_CURRENCY_MISMATCH" });
    expect(await d.items.list()).toEqual([]);
    const saved = await d.items.save({ ...draft, currency: "USD" }, settings);
    await d.store.update({ ...sale, currency: "CNY", amount: 9 });
    const edited = await d.items.save({ ...saved, notes: "Original USD sale retained" }, settings);
    expect(edited).toMatchObject({ currency: "USD", saleAmount: 600, saleEntryId: sale.id });
  });

  it("rolls business rows and capture triggers back together without notifying", async () => {
    const d = await device(); const listener = vi.fn(); d.items.subscribe(listener);
    const execute = d.backend.execute.bind(d.backend);
    vi.spyOn(d.backend, "execute").mockImplementation(async (sql, params) => {
      await execute(sql, params);
      if (sql.startsWith("INSERT INTO items")) throw new Error("write interrupted");
    });
    await expect(d.items.save(item(), settings)).rejects.toThrow("write interrupted");
    expect(await d.items.list()).toEqual([]);
    expect(await d.backend.select("SELECT * FROM sync_changes")).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });
});
