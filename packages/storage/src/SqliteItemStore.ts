import { historyTransaction } from "./history/transaction";
import { itemImageHashes, billDirectionForCategory, validateItemDraft, type Item, type ChronoEonSettings } from "@chronoeon/domain";
import type { ItemStore } from "@chronoeon/ports";
import { StorageError } from "./errors";
import { notifyLocalChange, runDatabaseOperation, subscribeLocalChanges } from "./persistence/coordinator";
import type { PersistencePort, SqlParam } from "./persistence/PersistencePort";
import { nextTimestamp } from "./persistence/timestamp";
import { UUID } from "./sync/protocol";

interface ItemRow {
  id: string;
  name: string;
  calendar: string;
  category: Item["category"];
  acquisition: Item["acquisition"];
  acquired_on: string;
  acquired_at: string;
  cost: number;
  currency: string;
  location: string | null;
  payment: string | null;
  purchase_entry_id: string | null;
  disposal: Item["disposal"] | null;
  disposed_on: string | null;
  sale_amount: number | null;
  sale_entry_id: string | null;
  images_json: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = ["id", "name", "calendar", "category", "acquisition", "acquired_on", "acquired_at", "cost", "currency", "location", "payment", "purchase_entry_id", "disposal", "disposed_on", "sale_amount", "sale_entry_id", "images_json", "notes", "created_at", "updated_at"] as const;

function toItem(row: ItemRow): Item {
  let images: unknown = [];
  try { images = JSON.parse(row.images_json); } catch { images = []; }
  return { id: row.id, name: row.name, calendarId: row.calendar, category: row.category, acquisition: row.acquisition,
    acquiredOn: row.acquired_on, acquiredAt: row.acquired_at.match(/(\d{2}:\d{2})$/)?.[1] ?? row.acquired_at, cost: row.cost, currency: row.currency,
    ...(row.location ? { location: row.location } : {}),
    ...(row.payment ? { payment: row.payment } : {}),
    ...(row.purchase_entry_id ? { purchaseEntryId: row.purchase_entry_id } : {}),
    ...(row.disposal ? { disposal: row.disposal } : {}),
    ...(row.disposed_on ? { disposedOn: row.disposed_on } : {}),
    ...(row.sale_amount !== null ? { saleAmount: row.sale_amount } : {}),
    ...(row.sale_entry_id ? { saleEntryId: row.sale_entry_id } : {}),
    images: Array.isArray(images) ? images.filter((image): image is string => typeof image === "string" && image !== "") : [],
    ...(row.notes ? { notes: row.notes } : {}),
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

  delete(id: string): Promise<void> {
    return runDatabaseOperation(this.backend, async () => {
      await historyTransaction(this.backend, async () => {
        await this.backend.execute("DELETE FROM items WHERE id=?", [id]);
      });
      notifyLocalChange(this.backend);
    });
  }

  save(item: Item, settings: ChronoEonSettings): Promise<Item> {
    return runDatabaseOperation(this.backend, async () => {
      const saved = await historyTransaction(this.backend, () => this.saveInTransaction(item, settings));
      notifyLocalChange(this.backend);
      return saved;
    });
  }

  /** Internal composition point: caller already owns the database queue and history transaction. */
  async saveInTransaction(item: Item, settings: ChronoEonSettings): Promise<Item> {
    try { validateItemDraft(item); }
    catch (error) { throw new StorageError("InvalidItem", "Invalid item fields", error instanceof Error ? error.message : undefined); }
    const images = item.images ?? [];
    const imageHashes = itemImageHashes(images);
    if (!UUID.test(item.id) || !Number.isFinite(Date.parse(item.createdAt))
      || images.some(image => !image.match(/^attachments\/([0-9a-f]{64})\.webp$/))
      || images.length !== imageHashes.length || new Set(images).size !== images.length) {
      throw new StorageError("InvalidItem", "An item requires a stable ID, timestamp and canonical image reference");
    }
    const rows = await this.backend.select<ItemRow>(`SELECT ${COLUMNS.join(",")} FROM items WHERE id=?`, [item.id]);
    const previous = rows[0];
    if (previous && item.updatedAt !== previous.updated_at) {
      throw new StorageError("RevisionMismatch", "The item changed since it was loaded", item.id);
    }
    await this.validateBinding(item.id, item.purchaseEntryId, previous?.purchase_entry_id, "expense", item.currency.trim(), settings);
    await this.validateBinding(item.id, item.saleEntryId, previous?.sale_entry_id, "income", item.currency.trim(), settings);
    const result: Item = { ...item, name: item.name.trim(), currency: item.currency.trim(), location: item.location?.trim() || undefined,
      notes: item.notes?.trim() || undefined, images,
      createdAt: previous?.created_at ?? item.createdAt, updatedAt: nextTimestamp(previous?.updated_at ?? item.createdAt) };
    const values: SqlParam[] = [result.id, result.name, result.calendarId, result.category, result.acquisition, result.acquiredOn, result.acquiredAt, result.cost, result.currency,
      result.location ?? null, result.payment ?? null, result.purchaseEntryId ?? null, result.disposal ?? null, result.disposedOn ?? null, result.saleAmount ?? null,
      result.saleEntryId ?? null, JSON.stringify(images), result.notes ?? null, result.createdAt, result.updatedAt];
    await this.backend.execute(`INSERT INTO items (${COLUMNS.join(",")}) VALUES (${COLUMNS.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((column) => column !== "id" && column !== "created_at").map((column) => `${column}=excluded.${column}`).join(",")}`, values);
    return result;
  }

  private async validateBinding(assetId: string, entryId: string | undefined, previous: string | null | undefined, direction: "expense" | "income", currency: string, settings: ChronoEonSettings): Promise<void> {
    // Historical references survive bill deletion/reclassification; only binding is validated.
    if (entryId === undefined || entryId === previous) return;
    const bills = await this.backend.select<{ modality: string; category: string | null; currency: string | null; calendar: string | null }>("SELECT modality,category,currency,calendar FROM entries WHERE id=?", [entryId]);
    if (!bills[0] || bills[0].modality !== "bill") throw new StorageError("ItemBillNotFound", "The linked bill does not exist", entryId);
    if (billDirectionForCategory(bills[0].category ?? "", settings, bills[0].calendar ?? undefined) !== direction) {
      throw new StorageError("ItemBillDirectionMismatch", "Purchase links require expenses; sale links require income", entryId);
    }
    if (direction === "income" && bills[0].currency !== currency) {
      throw new StorageError("InvalidItem", "The sale bill must use the item currency", "ASSET_BILL_CURRENCY_MISMATCH");
    }
    const bound = await this.backend.select<{ id: string }>("SELECT id FROM items WHERE id<>? AND (purchase_entry_id=? OR sale_entry_id=?) LIMIT 1", [assetId, entryId, entryId]);
    if (bound.length) throw new StorageError("ItemBillAlreadyLinked", "This bill is already linked to another item", entryId);
  }
}
