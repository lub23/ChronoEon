import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDefaultSettings, type ChronoEonSettings, type Entry, type LedgerImportPayload } from "@chronoeon/domain";
import type { PersistencePort, SqlParam } from "../persistence/PersistencePort";
import { SqliteEntryStore } from "../SqliteEntryStore";
import { SyncStore } from "../sync/SyncStore";
import { openMemoryStore } from "./helpers";

const incomeId = "ledger-" + "a".repeat(24);
const expenseId = "ledger-" + "b".repeat(24);
const billId = "10000000-0000-4000-8000-000000000001";
const oldId = "20000000-0000-4000-8000-000000000001";
const eventId = "30000000-0000-4000-8000-000000000001";
function entry(id = oldId, kind: Entry["kind"] = "bill"): Entry {
  return { id, kind, title: "Existing entry", date: "2026-01-01", allDay: true, category: "Expense/Daily",
    amount: kind === "bill" ? 12 : undefined, currency: "CNY", color: "#777777", tags: ["old"], createdAt: "2026-01-01T00:00:00.000Z" };
}
function payload(): LedgerImportPayload {
  return {
    format: "chronoeon-ledger", version: 1, source: { sha256: "f".repeat(64), sheet: "Transactions" }, currency: "CNY",
    categories: [{ id: incomeId, name: "Income", direction: "income", sub: ["Salary"] }, { id: expenseId, name: "Expense", direction: "expense", sub: ["Meal"] }],
    transactions: [
      { id: billId, row: 2, date: "2026-09-01", time: "12:34", title: "Incoming", categoryId: incomeId, subcategory: "Salary", amountCents: 12345, payment: "Cash", tags: ["one", "two"] },
      { id: "10000000-0000-4000-8000-000000000002", row: 3, date: "2026-09-02", title: "Outgoing", categoryId: expenseId, subcategory: "Meal", amountCents: 2345, payment: "Cash", tags: [], note: "Preserve\nline breaks" },
    ],
    summary: { count: 2, incomeCount: 1, expenseCount: 1, incomeCents: 12345, expenseCents: 2345, netCents: 10000, firstDate: "2026-09-01", lastDate: "2026-09-02" },
  };
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const { store, backend } = await openMemoryStore(); cleanup.push(() => backend.close());
  const sync = new SyncStore(backend);
  const settings = createDefaultSettings();
  await sync.setSettings({ format: "chronoeon-settings", version: 1, settings, preferences: { theme: "dark" } });
  return { store, backend, sync, settings };
}

describe("atomic ledger replacement", () => {
  it("replaces only bills, preserves catalogs/preferences and journals deletions + inserts + settings", async () => {
    const { store, backend, sync, settings } = await fixture();
    await store.create(entry());
    const event = await store.create(entry(eventId, "event"));
    await backend.execute("CREATE TABLE ledger_test_bindings(id TEXT PRIMARY KEY, purchase_entry_id TEXT)");
    await backend.execute("INSERT INTO ledger_test_bindings VALUES ('asset',?)", [oldId]);
    const deviceId = await sync.deviceId();
    const datasetId = await sync.bindDataset();
    await sync.flush();
    const notifications: string[] = [];
    store.subscribe((event) => notifications.push(event.type));
    const result = await store.replaceBills(settings, payload());
    expect(result).toEqual({ ...payload().summary, replacedCount: 1 });
    expect((await store.list({ kinds: ["bill"] })).map((bill) => [bill.amount, bill.category])).toEqual([[123.45, `${incomeId}/Salary`], [23.45, `${expenseId}/Meal`]]);
    expect(await store.get(eventId)).toEqual(event);
    expect((await store.deletedEntries()).map((row) => row.id)).toEqual([oldId]);
    expect(await backend.select("SELECT * FROM ledger_test_bindings")).toEqual([{ id: "asset", purchase_entry_id: oldId }]);
    const saved = await sync.getSettings() as { settings: ChronoEonSettings; preferences: { theme: string } };
    expect(saved.settings.bill.categories.slice(0, settings.bill.categories.length)).toEqual(settings.bill.categories);
    expect(saved.settings.bill.categories).toHaveLength(settings.bill.categories.length + 2);
    expect(saved.preferences).toEqual({ theme: "dark" });
    expect(await sync.deviceId()).toBe(deviceId);
    expect(await sync.bindDataset()).toBe(datasetId);
    expect(notifications).toEqual(["rebuilt"]);
    expect(await backend.select("SELECT applying FROM sync_control")).toEqual([{ applying: 0 }]);
    const changes = await backend.select<{ entity: string; entity_id: string; data_json: string | null }>("SELECT entity,entity_id,data_json FROM sync_changes");
    expect(changes.some((row) => row.entity === "entry" && row.entity_id === oldId && row.data_json === null)).toBe(true);
    expect(changes.some((row) => row.entity === "entry" && row.entity_id === billId && row.data_json !== null)).toBe(true);
    expect(changes.some((row) => row.entity === "settings")).toBe(true);
    await sync.flush();
    const snapshot = await sync.snapshot(datasetId);
    expect(snapshot).toContain(billId);
    expect(await backend.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("rolls back bills, recovery snapshots, tags, settings and journal on a late failure", async () => {
    const { store, backend, settings } = await fixture();
    await store.create(entry());
    const tables = ["entries", "entry_tags", "deleted_entries", "sync_settings", "sync_changes", "sync_meta"];
    const read = () => Promise.all(tables.map((table) => backend.select(`SELECT * FROM ${table} ORDER BY rowid`)));
    const before = await read();
    const execute = backend.execute.bind(backend);
    vi.spyOn(backend, "execute").mockImplementation(async (sql, params) => {
      if (sql.startsWith("UPDATE sync_settings")) throw new Error("Injected late failure");
      await execute(sql, params);
    });
    const notifications: string[] = [];
    store.subscribe((event) => notifications.push(event.type));
    await expect(store.replaceBills(settings, payload())).rejects.toThrow("Injected late failure");
    expect(await read()).toEqual(before);
    expect(notifications).toEqual([]);
  });

  it("rejects stale settings, absent settings and a non-bill ID collision before changing bills", async () => {
    const { store, sync, settings } = await fixture();
    await store.create(entry());
    const changed = structuredClone(settings); changed.bill.categories[0].name = "Edited";
    await sync.setSettings({ settings: changed });
    await expect(store.replaceBills(settings, payload())).rejects.toThrow("LEDGER_SETTINGS_CHANGED");
    await sync.setSettings({ settings });
    await store.create(entry(billId, "task"));
    await expect(store.replaceBills(settings, payload())).rejects.toThrow("LEDGER_ID_CONFLICT");
    expect((await store.list()).map((row) => row.id).sort()).toEqual([billId, oldId].sort());
    const empty = await openMemoryStore(); cleanup.push(() => empty.backend.close());
    await expect(empty.store.replaceBills(settings, payload())).rejects.toThrow("LEDGER_SETTINGS_MISSING");
  });

  it("updates surviving identities without deleting attachments or conversation links", async () => {
    const { store, backend, sync, settings } = await fixture();
    await store.replaceBills(settings, payload());
    const bill = (await store.get(billId))!;
    await store.update({ ...bill, images: [`attachments/${"a".repeat(64)}.webp`] });
    await backend.execute("INSERT INTO ai_conversations(id,provider_kind,created_at,updated_at,parent_entry_id) VALUES (?,'openai-compatible',?,?,?)",
      ["40000000-0000-4000-8000-000000000001", bill.createdAt, bill.createdAt, billId]);
    const current = (await sync.getSettings())!.settings as ChronoEonSettings;
    const before = await backend.select("SELECT * FROM attachments");
    await store.replaceBills(current, payload());
    expect(await backend.select("SELECT * FROM attachments")).toEqual(before);
    expect(await backend.select("SELECT parent_entry_id FROM ai_conversations")).toEqual([{ parent_entry_id: billId }]);
    expect((await store.get(billId))?.createdAt).toBe(bill.createdAt);
    expect((await sync.getSettings())!.settings).toEqual(current);
  });
});

/** Test-only adapter; production continues to use the existing Tauri connection. */
class NodeBackend implements PersistencePort {
  constructor(readonly db: DatabaseSync) {}
  async execute(sql: string, params: SqlParam[] = []) {
    if (params.length) this.db.prepare(sql).run(...params.map((value) => typeof value === "boolean" ? Number(value) : value));
    else this.db.exec(sql);
  }
  async select<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params.map((value) => typeof value === "boolean" ? Number(value) : value)) as T[];
  }
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = await work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  async close() { this.db.close(); }
}

describe("consistent ledger backup", () => {
  it("captures committed WAL rows into a valid independent file without overwriting a backup", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "chronoeon-ledger-backup-"));
    const backend = new NodeBackend(new DatabaseSync(path.join(folder, "source.db")));
    cleanup.push(async () => { await backend.close(); await rm(folder, { recursive: true, force: true }); });
    const store = await SqliteEntryStore.create(backend);
    await store.create(entry());
    const destination = path.join(folder, "backup.db");
    await store.backup(destination);
    const backup = new DatabaseSync(destination, { readOnly: true });
    try {
      expect(backup.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
      expect(backup.prepare("SELECT id,amount FROM entries").all()).toEqual([{ id: oldId, amount: 12 }]);
      expect(backup.prepare("SELECT tag FROM entry_tags").all()).toEqual([{ tag: "old" }]);
    } finally { backup.close(); }
    await expect(store.backup(destination)).rejects.toThrow();
    await expect(store.backup("relative.db")).rejects.toThrow("LEDGER_BACKUP_PATH_INVALID");
    expect(await store.get(oldId)).not.toBeNull();
  });
});
