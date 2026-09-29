import { itemImageHash, billDirectionForCategory, validateItemDraft, type Item, type ChronoEonSettings } from "@chronoeon/domain";
import type { ItemStore } from "@chronoeon/ports";
import { StorageError } from "./errors";
import { notifyLocalChange, runDatabaseOperation, subscribeLocalChanges } from "./persistence/coordinator";
import type { PersistencePort, SqlParam } from "./persistence/PersistencePort";
import { nextTimestamp } from "./persistence/timestamp";
import { UUID } from "./sync/protocol";

interface ItemRow {
  id: string;
  name: string;
  category: Item["category"];
  acquisition: Item["acquisition"];
  acquired_on: string;
  acquired_at: string;
  cost: number;
  currency: string;
  purchase_entry_id: string | null;
  disposal: Item["disposal"] | null;
  disposed_on: string | null;
  sale_amount: number | null;
  sale_entry_id: string | null;
  image: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = ["id", "name", "category", "acquisition", "acquired_on", "acquired_at", "cost", "currency", "purchase_entry_id", "disposal", "disposed_on", "sale_amount", "sale_entry_id", "image", "notes", "created_at", "updated_at"] as const;

function toItem(row: ItemRow): Item {
  return { id: row.id, name: row.name, category: row.category, acquisition: row.acquisition,
    acquiredOn: row.acquired_on, acquiredAt: row.acquired_at, cost: row.cost, currency: row.currency,
    purchaseEntryId: row.purchase_entry_id ?? undefined, disposal: row.disposal ?? undefined,
    disposedOn: row.disposed_on ?? undefined, saleAmount: row.sale_amount ?? undefined,
    saleEntryId: row.sale_entry_id ?? undefined, image: row.image ?? undefined, notes: row.notes ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

/** Uses the same migrated SQLite connection and whole-operation queue as entries/sync. */
export class SqliteItemStore implements ItemStore {
  constructor(private readonly backend: PersistencePort) {}

  list(): Promise<Item[]> {
    return runDatabaseOperation(this.backend, async () => {
      const rows = await this.backend.select<ItemRow>(`SELECT ${COLUMNS.join(",")} FROM items ORDER BY acquired_on DESC, created_at DESC, id`);
      return rows.map(toItem);
    });
  }

  subscribe(listener: () => void): () => void { return subscribeLocalChanges(this.backend, listener); }

  save(item: Item, settings: ChronoEonSettings): Promise<Item> {
    return runDatabaseOperation(this.backend, async () => {
      const saved = await this.backend.transaction(async () => {
        try { validateItemDraft(item); }
        catch (error) { throw new StorageError("InvalidItem", "Invalid item fields", error instanceof Error ? error.message : undefined); }
        if (!UUID.test(item.id) || !Number.isFinite(Date.parse(item.createdAt))
          || (item.image !== undefined && !itemImageHash(item.image))) {
          throw new StorageError("InvalidItem", "An item requires a stable ID, timestamp and canonical image reference");
        }
        const rows = await this.backend.select<ItemRow>(`SELECT ${COLUMNS.join(",")} FROM items WHERE id=?`, [item.id]);
        const previous = rows[0];
        if (previous && item.updatedAt !== previous.updated_at) {
          throw new StorageError("RevisionMismatch", "The item changed since it was loaded", item.id);
        }
        await this.validateBinding(item.id, item.purchaseEntryId, previous?.purchase_entry_id, "expense", item.currency.trim(), settings);
        await this.validateBinding(item.id, item.saleEntryId, previous?.sale_entry_id, "income", item.currency.trim(), settings);
        const result: Item = { ...item, name: item.name.trim(), currency: item.currency.trim(), notes: item.notes?.trim() || undefined,
          createdAt: previous?.created_at ?? item.createdAt, updatedAt: nextTimestamp(previous?.updated_at ?? item.createdAt) };
        const values: SqlParam[] = [result.id, result.name, result.category, result.acquisition, result.acquiredOn, result.acquiredAt, result.cost, result.currency,
          result.purchaseEntryId ?? null, result.disposal ?? null, result.disposedOn ?? null, result.saleAmount ?? null,
          result.saleEntryId ?? null, result.image ?? null, result.notes ?? null, result.createdAt, result.updatedAt];
        await this.backend.execute(`INSERT INTO items (${COLUMNS.join(",")}) VALUES (${COLUMNS.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((column) => column !== "id" && column !== "created_at").map((column) => `${column}=excluded.${column}`).join(",")}`, values);
        return result;
      });
      notifyLocalChange(this.backend);
      return saved;
    });
  }

  private async validateBinding(assetId: string, entryId: string | undefined, previous: string | null | undefined, direction: "expense" | "income", currency: string, settings: ChronoEonSettings): Promise<void> {
    // Historical references survive bill deletion/reclassification; only binding is validated.
    if (entryId === undefined || entryId === previous) return;
    const bills = await this.backend.select<{ modality: string; category: string | null; currency: string | null }>("SELECT modality,category,currency FROM entries WHERE id=?", [entryId]);
    if (!bills[0] || bills[0].modality !== "bill") throw new StorageError("ItemBillNotFound", "The linked bill does not exist", entryId);
    if (billDirectionForCategory(bills[0].category ?? "", settings) !== direction) {
      throw new StorageError("ItemBillDirectionMismatch", "Purchase links require expenses; sale links require income", entryId);
    }
    if (direction === "income" && bills[0].currency !== currency) {
      throw new StorageError("InvalidItem", "The sale bill must use the item currency", "ASSET_BILL_CURRENCY_MISMATCH");
    }
    const bound = await this.backend.select<{ id: string }>("SELECT id FROM items WHERE id<>? AND (purchase_entry_id=? OR sale_entry_id=?) LIMIT 1", [assetId, entryId, entryId]);
    if (bound.length) throw new StorageError("ItemBillAlreadyLinked", "This bill is already linked to another item", entryId);
  }
}
