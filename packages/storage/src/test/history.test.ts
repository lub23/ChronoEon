import { afterEach, describe, expect, it, vi } from "vitest";
import { createEntryId, DEFAULT_CHRONOEON_SETTINGS, draftToItem, type Entry } from "@chronoeon/domain";
import { SqliteItemStore } from "../SqliteItemStore";
import { SyncStore } from "../sync/SyncStore";
import { OperationHistoryStore } from "../history/OperationHistoryStore";
import { RECOVERY_RETENTION_MS } from "../history/transaction";
import { openMemoryStore } from "./helpers";
import type { MemorySqliteBackend } from "../persistence/MemorySqliteBackend";

const opened: MemorySqliteBackend[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(opened.splice(0).map(db => db.close())); });
async function device() {
  const result = await openMemoryStore(); opened.push(result.backend);
  return { ...result, sync: new SyncStore(result.backend), history: new OperationHistoryStore(result.backend), items: new SqliteItemStore(result.backend) };
}
function entry(patch: Partial<Entry> = {}): Entry {
  return { id: createEntryId(), kind: "task", title: "Original", date: "2026-10-04", category: "general", color: "#777777", createdAt: new Date().toISOString(), ...patch };
}

describe("independent operation recovery", () => {
  it("keeps each offline edit and restores fields, tags and attachments atomically", async () => {
    const d = await device(); const image = `attachments/${"a".repeat(64)}.webp`;
    const original = await d.store.create(entry({ tags: ["old"], images: [image] }));
    await d.store.update({ ...original, title: "Edited", tags: ["new"], images: [] });
    const history = await d.sync.history();
    expect(history.map(record => record.action)).toEqual(["update", "create"]);
    expect(history[0].changes.map(change => change.table)).toEqual(expect.arrayContaining(["entries", "entry_tags", "attachments"]));
    await d.sync.restoreHistory(history[0].id);
    expect(await d.store.get(original.id)).toEqual(original);
    expect((await d.sync.history())[0]).toMatchObject({ action: "restore", restoredFrom: history[0].id });
    await d.sync.flush();
    expect((await d.sync.status()).pending).toBeGreaterThan(0);
    expect(await d.backend.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("rejects stale restores without partial writes or an empty history header", async () => {
    const d = await device(); const original = await d.store.create(entry());
    await d.store.update({ ...original, title: "First" });
    const first = (await d.sync.history())[0];
    await d.store.update({ ...original, title: "Second" });
    const before = await d.sync.history();
    await expect(d.sync.restoreHistory(first.id)).rejects.toThrow("HISTORY_CHANGED");
    expect((await d.store.get(original.id))?.title).toBe("Second");
    expect(await d.sync.history()).toEqual(before);
  });

  it("undoes create into the recycle bin and does not lose attachment recovery", async () => {
    const d = await device(); const original = await d.store.create(entry({ images: [`attachments/${"b".repeat(64)}.webp`] }));
    const create = (await d.sync.history())[0];
    await d.sync.restoreHistory(create.id);
    expect(await d.store.get(original.id)).toBeNull();
    expect((await d.store.deletedEntries())[0].entry).toEqual(original);
    await d.store.restoreDeleted(original.id);
    expect(await d.store.get(original.id)).toEqual(original);
  });

  it("clears trash and history independently; history restores a cleared trash deletion", async () => {
    const d = await device(); const original = await d.store.create(entry());
    await d.store.delete(original.id);
    const deletion = (await d.sync.history())[0];
    await d.store.clearDeletedEntries();
    expect(await d.store.deletedEntries()).toEqual([]);
    expect(await d.sync.history()).toHaveLength(2);
    await d.sync.restoreHistory(deletion.id);
    expect(await d.store.get(original.id)).toEqual(original);
    await d.store.delete(original.id);
    await d.sync.clearHistory();
    expect(await d.sync.history()).toEqual([]);
    expect(await d.store.deletedEntries()).toHaveLength(1);
  });

  it("expires each store at seven days even when sync never runs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-10-04T00:00:00.000Z").getTime(); vi.setSystemTime(start);
    const d = await device(); const original = await d.store.create(entry());
    const creation = (await d.sync.history())[0];
    vi.setSystemTime(start + 1000); await d.store.delete(original.id);
    vi.setSystemTime(start + RECOVERY_RETENTION_MS);
    expect(await d.sync.history()).toHaveLength(1);
    expect(await d.store.deletedEntries()).toHaveLength(1);
    await expect(d.sync.restoreHistory(creation.id)).rejects.toThrow("HISTORY_EXPIRED");
    vi.setSystemTime(start + RECOVERY_RETENTION_MS + 1000);
    expect(await d.store.deletedEntries()).toEqual([]);
    expect(await d.sync.history()).toEqual([]);
  });

  it("does not record remote snapshot projection as a local edit", async () => {
    const a = await device(); const b = await device();
    await a.store.create(entry()); const dataset = await a.sync.bindDataset();
    await b.sync.applyDocuments([{ path: "snapshot/test.jsonl.zst", content: await a.sync.snapshot(dataset), hash: "test" }], dataset);
    expect(await b.store.list()).toHaveLength(1);
    expect(await b.sync.history()).toEqual([]);
  });

  it("keeps history and trash when a snapshot is rebuilt and published", async () => {
    const d = await device(); const original = await d.store.create(entry()); await d.store.delete(original.id);
    const dataset = await d.sync.bindDataset(); const content = await d.sync.snapshot(dataset);
    const document = { path: "snapshot/new.jsonl.zst", content, hash: "test" };
    await d.sync.cacheSnapshot(document, "test");
    await d.sync.markPublished([document], new Date(), "test", { path: document.path, createdAt: new Date().toISOString() });
    expect(await d.store.deletedEntries()).toHaveLength(1);
    expect(await d.sync.history()).toHaveLength(2);
  });

  it("restores item edits and refuses to steal a bill binding created later", async () => {
    const d = await device(); const bill = await d.store.create(entry({ kind: "bill", category: "expense", amount: 100, currency: "CNY" }));
    const billCreation = (await d.sync.history())[0];
    const first = await d.items.save(draftToItem({ name: "Camera", calendarId: "default", category: "electronics", acquisition: "purchase", acquiredOn: "2026-10-04", acquiredAt: "09:00", cost: 100, currency: "CNY", purchaseEntryId: bill.id }), DEFAULT_CHRONOEON_SETTINGS);
    await expect(d.sync.restoreHistory(billCreation.id)).rejects.toThrow("HISTORY_CHANGED");
    await d.items.save({ ...first, name: "New camera" }, DEFAULT_CHRONOEON_SETTINGS);
    await d.sync.restoreHistory((await d.sync.history())[0].id);
    const restored = (await d.items.list())[0]; expect(restored.name).toBe("Camera");
    await d.items.delete(first.id); const deletion = (await d.sync.history())[0];
    await d.items.save({ ...first, id: createEntryId() }, DEFAULT_CHRONOEON_SETTINGS);
    await expect(d.sync.restoreHistory(deletion.id)).rejects.toThrow("HISTORY_CHANGED");
    expect(await d.items.list()).toHaveLength(1);
  });

  it("retains removed photos while history references them, then releases after clear", async () => {
    const d = await device(); const hash = "c".repeat(64);
    const original = await d.store.create(entry({ images: [`attachments/${hash}.webp`] }));
    await d.store.update({ ...original, images: [] }); await d.sync.flush();
    expect(await d.sync.attachmentHashes()).toContain(hash);
    await d.sync.clearHistory();
    expect(await d.sync.attachmentHashes()).not.toContain(hash);
  });

  it("atomically creates and recovers a bill with its item binding", async () => {
    const d = await device();
    const item = await d.items.save(draftToItem({ name: "Camera", calendarId: "default", category: "electronics", acquisition: "purchase", acquiredOn: "2026-10-04", acquiredAt: "09:00", cost: 100, currency: "CNY" }), DEFAULT_CHRONOEON_SETTINGS);
    const bill = await d.store.createWithItemLink(entry({ kind: "bill", category: "expense", amount: 100, currency: "CNY" }), item, DEFAULT_CHRONOEON_SETTINGS);
    expect((await d.items.list())[0].purchaseEntryId).toBe(bill.id);
    const creation = (await d.sync.history())[0];
    expect(creation.changes.map(change => change.table)).toEqual(expect.arrayContaining(["entries", "items"]));
    await d.sync.restoreHistory(creation.id);
    expect(await d.store.get(bill.id)).toBeNull();
    expect((await d.items.list())[0].purchaseEntryId).toBeUndefined();
    await d.sync.restoreHistory((await d.sync.history())[0].id);
    expect(await d.store.get(bill.id)).toEqual(bill);
    expect((await d.items.list())[0].purchaseEntryId).toBe(bill.id);
  });

  it("rolls back linked bill creation on stale items and rejects competing bindings", async () => {
    const d = await device();
    const first = await d.items.save(draftToItem({ name: "Camera", calendarId: "default", category: "electronics", acquisition: "purchase", acquiredOn: "2026-10-04", acquiredAt: "09:00", cost: 100, currency: "CNY" }), DEFAULT_CHRONOEON_SETTINGS);
    const updated = await d.items.save({ ...first, name: "Edited" }, DEFAULT_CHRONOEON_SETTINGS);
    const bill = () => entry({ kind: "bill", category: "expense", amount: 100, currency: "CNY" });
    const count = (await d.sync.history()).length;
    await expect(d.store.createWithItemLink(bill(), first, DEFAULT_CHRONOEON_SETTINGS)).rejects.toMatchObject({ code: "RevisionMismatch" });
    expect(await d.store.list()).toEqual([]);
    expect(await d.sync.history()).toHaveLength(count);
    await expect(d.store.createWithItemLink({ ...bill(), category: "income" }, updated, DEFAULT_CHRONOEON_SETTINGS)).rejects.toMatchObject({ code: "ItemBillDirectionMismatch" });
    const results = await Promise.allSettled([d.store.createWithItemLink(bill(), updated, DEFAULT_CHRONOEON_SETTINGS), d.store.createWithItemLink(bill(), updated, DEFAULT_CHRONOEON_SETTINGS)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await d.store.list()).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "ItemBillAlreadyLinked" } });
  });

  it("removes old device preference fields from new snapshots and packed operations", async () => {
    const d = await device();
    await d.backend.execute("INSERT INTO sync_settings(id,payload_json) VALUES (?,?)", ["00000000-0000-5000-8000-000000000001", JSON.stringify({ "/preferences/theme": "old-dark", "/preferences/locale": "old-zh", "/settings/defaultCalendarID": "default" })]);
    const dataset = await d.sync.bindDataset();
    const snapshot = await d.sync.snapshot(dataset);
    expect(snapshot).not.toContain("old-dark"); expect(snapshot).not.toContain("old-zh");
    const batches = await d.sync.pack();
    expect(batches).toHaveLength(1);
    expect(batches[0].content).not.toContain("old-dark"); expect(batches[0].content).not.toContain("old-zh");
    const other = await device();
    await other.sync.applyDocuments([{ path: batches[0].path, content: batches[0].content, hash: "packed" }], dataset);
    expect(await other.sync.getSettings()).toEqual({ settings: { defaultCalendarID: "default" } });
  });

  it("records shared settings, never device preferences, and can restore catalog edits", async () => {
    const d = await device();
    await d.sync.setSettings({ format: "chronoeon-settings", version: 1, settings: DEFAULT_CHRONOEON_SETTINGS, preferences: { theme: "dark", locale: "zh" } });
    const first = await d.sync.getSettings();
    expect(await d.sync.history()).toEqual([]);
    expect(first).not.toHaveProperty("preferences");
    const changed = structuredClone(DEFAULT_CHRONOEON_SETTINGS); changed.calendars[0].name = "Renamed";
    await d.sync.setSettings({ format: "chronoeon-settings", version: 1, settings: changed });
    const record = (await d.sync.history())[0];
    await d.sync.restoreHistory(record.id);
    expect(await d.sync.getSettings()).toEqual(first);
    const count = (await d.sync.history()).length;
    await d.sync.setSettings({ ...first, preferences: { theme: "light", locale: "en" } });
    expect(await d.sync.history()).toHaveLength(count);
  });
});
