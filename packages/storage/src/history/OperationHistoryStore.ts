import { archiveEntryForRecovery } from "../SqliteEntryStore";
import type { PersistencePort, SqlParam } from "../persistence/PersistencePort";
import { notifyLocalChange, runDatabaseOperation } from "../persistence/coordinator";
import { nextTimestamp } from "../persistence/timestamp";
import { equal } from "../sync/protocol";
import { historyTransaction, pruneRecovery } from "./transaction";

export type HistoryRow = Record<string, SqlParam>;
export interface OperationHistoryChange {
  table: string;
  key: SqlParam[];
  before: HistoryRow | null;
  after: HistoryRow | null;
}
export interface OperationHistoryRecord {
  id: string;
  createdAt: string;
  restoredFrom: string | null;
  action: "create" | "update" | "delete" | "restore";
  title: string;
  changes: OperationHistoryChange[];
}
interface StoredChange { table_name: string; row_key: string; before_json: string | null; after_json: string | null }
const KEYS: Record<string, string[]> = {
  entries: ["id"], items: ["id"], entry_tags: ["entry_id", "tag"], attachments: ["id"],
  attachment_ingest_queue: ["attachment_id"], sync_settings: ["id"], ai_conversations: ["id"], ai_messages: ["id"],
};
const ORDER = ["entries", "items", "ai_conversations", "ai_messages", "entry_tags", "attachments", "attachment_ingest_queue", "sync_settings"];
function decode(row: StoredChange): OperationHistoryChange {
  return { table: row.table_name, key: JSON.parse(row.row_key), before: row.before_json === null ? null : JSON.parse(row.before_json), after: row.after_json === null ? null : JSON.parse(row.after_json) };
}
function comparable(row: HistoryRow | null): HistoryRow | null {
  if (!row) return null;
  const copy = { ...row };
  delete copy.updated_at;
  return copy;
}
function predicate(table: string): string {
  const keys = KEYS[table];
  if (!keys) throw new Error("HISTORY_INVALID_RECORD");
  return keys.map(key => `${key}=?`).join(" AND ");
}

/** Recovery is local user data, not an alternate sync log. */
export class OperationHistoryStore {
  constructor(private readonly db: PersistencePort) {}

  list(limit = 100, offset = 0, now = new Date()): Promise<OperationHistoryRecord[]> {
    return runDatabaseOperation(this.db, async () => {
      await pruneRecovery(this.db, now);
      const records = await this.db.select<{ id: string; created_at: string; restored_from: string | null }>(
        "SELECT * FROM operation_history ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?", [Math.max(1, Math.min(500, Math.trunc(limit))), Math.max(0, Math.trunc(offset))]);
      const result: OperationHistoryRecord[] = [];
      for (const record of records) {
        const changes = (await this.db.select<StoredChange>("SELECT * FROM operation_history_changes WHERE operation_id=? ORDER BY sequence", [record.id])).map(decode);
        const primary = changes.find(change => ["entries", "items", "sync_settings"].includes(change.table)) ?? changes[0];
        if (!primary) continue;
        const row = primary.after ?? primary.before;
        result.push({ id: record.id, createdAt: record.created_at, restoredFrom: record.restored_from,
          action: record.restored_from ? "restore" : !primary.before ? "create" : !primary.after ? "delete" : "update",
          title: String(row?.title ?? row?.name ?? (primary.table === "sync_settings" ? "settings" : primary.table)), changes });
      }
      return result;
    });
  }

  clear(): Promise<void> {
    return runDatabaseOperation(this.db, async () => {
      await this.db.execute("DELETE FROM operation_history");
      notifyLocalChange(this.db);
    });
  }

  prune(now = new Date()): Promise<void> { return runDatabaseOperation(this.db, () => pruneRecovery(this.db, now)); }

  restore(id: string): Promise<void> {
    return runDatabaseOperation(this.db, async () => {
      await historyTransaction(this.db, async () => {
        if (!(await this.db.select("SELECT id FROM operation_history WHERE id=?", [id])).length) throw new Error("HISTORY_EXPIRED");
        const changes = (await this.db.select<StoredChange>("SELECT * FROM operation_history_changes WHERE operation_id=? ORDER BY sequence", [id])).map(decode);
        if (!changes.length) throw new Error("HISTORY_EXPIRED");
        for (const change of changes) {
          const columns = Object.keys(change.after ?? change.before ?? {}).map(column => `"${column.replaceAll('"', '""')}"`).join(",");
          const rows = await this.db.select<HistoryRow>(`SELECT ${columns} FROM ${change.table} WHERE ${predicate(change.table)}`, change.key);
          if (!equal(comparable(rows[0] ?? null), comparable(change.after))) throw new Error("HISTORY_CHANGED");
          if (change.table === "items" && change.before) {
            for (const column of ["purchase_entry_id", "sale_entry_id"]) {
              const bill = change.before[column];
              if (bill && (await this.db.select("SELECT id FROM items WHERE id<>? AND (purchase_entry_id=? OR sale_entry_id=?)", [change.before.id, bill, bill])).length) throw new Error("HISTORY_CHANGED");
            }
          }
          if (change.table === "entries" && !change.before) {
            for (const [table, where] of [
              ["items", "purchase_entry_id=? OR sale_entry_id=?"],
              ["ai_conversations", "parent_entry_id=?"],
              ["ai_messages", "proposed_entry_id=?"],
            ]) {
              const links = await this.db.select<{ id: string }>(`SELECT id FROM ${table} WHERE ${where}`, table === "items" ? [change.key[0], change.key[0]] : change.key);
              if (links.some(link => !changes.some(candidate => candidate.table === table && candidate.key[0] === link.id))) throw new Error("HISTORY_CHANGED");
            }
            for (const [table, key] of [["attachments", "id"], ["entry_tags", "tag"]]) {
              const children = await this.db.select<HistoryRow>(`SELECT * FROM ${table} WHERE entry_id=?`, change.key);
              if (children.some(child => !changes.some(candidate => candidate.table === table && candidate.after?.[key] === child[key] && candidate.after.entry_id === child.entry_id))) throw new Error("HISTORY_CHANGED");
            }
          }
        }
        for (const change of changes) {
          if (change.table === "entries" && !change.before) await archiveEntryForRecovery(this.db, String(change.key[0]));
        }
        // Delete children first, then restore parents before their dependants.
        for (const change of [...changes].sort((a,b) => ORDER.indexOf(b.table) - ORDER.indexOf(a.table))) {
          if (!change.before) await this.db.execute(`DELETE FROM ${change.table} WHERE ${predicate(change.table)}`, change.key);
        }
        for (const change of [...changes].sort((a,b) => ORDER.indexOf(a.table) - ORDER.indexOf(b.table))) {
          if (!change.before) continue;
          const row = { ...change.before };
          if ("updated_at" in row) row.updated_at = nextTimestamp(typeof change.after?.updated_at === "string" ? change.after.updated_at : undefined);
          const columns = Object.keys(row);
          const updates = columns.filter(column => !KEYS[change.table].includes(column));
          await this.db.execute(`INSERT INTO ${change.table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT(${KEYS[change.table].join(",")}) DO UPDATE SET ${updates.map(column => `${column}=excluded.${column}`).join(",")}`, columns.map(column => row[column]));
          if (change.table === "entries" && !change.after) await this.db.execute("DELETE FROM deleted_entries WHERE id=?", [row.id]);
        }
      }, id);
      notifyLocalChange(this.db);
    });
  }

  /** Keep compressed photos alive while either recovery store still references them. */
  async attachmentHashesDirect(): Promise<string[]> {
    const hashes = new Set<string>();
    const rows = await this.db.select<{ payload: string }>(
      "SELECT before_json AS payload FROM operation_history_changes WHERE before_json IS NOT NULL UNION ALL SELECT after_json AS payload FROM operation_history_changes WHERE after_json IS NOT NULL UNION ALL SELECT payload_json AS payload FROM deleted_entries");
    for (const row of rows) for (const match of row.payload.matchAll(/[a-f0-9]{64}/g)) hashes.add(match[0]);
    return [...hashes];
  }
}
