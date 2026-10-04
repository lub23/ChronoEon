import { createEntryId } from "@chronoeon/domain";
import type { PersistencePort } from "../persistence/PersistencePort";

export const RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60_000;

export async function pruneRecovery(db: PersistencePort, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - RECOVERY_RETENTION_MS).toISOString();
  await db.execute("DELETE FROM operation_history WHERE created_at <= ?", [cutoff]);
  await db.execute("DELETE FROM deleted_entries WHERE deleted_at <= ?", [cutoff]);
}

/** Called inside the shared operation queue. The header and all row versions
 * commit together; sync projection has no active group and is never recorded. */
export function historyTransaction<T>(db: PersistencePort, work: () => Promise<T>, restoredFrom: string | null = null): Promise<T> {
  return db.transaction(async () => {
    await pruneRecovery(db);
    const id = createEntryId();
    await db.execute("INSERT INTO operation_history(id,created_at,restored_from) VALUES (?,?,?)", [id, new Date().toISOString(), restoredFrom]);
    await db.execute("UPDATE history_control SET operation_id=? WHERE id=1", [id]);
    const result = await work();
    await db.execute("UPDATE history_control SET operation_id=NULL WHERE id=1");
    await db.execute("DELETE FROM operation_history_changes WHERE operation_id=? AND before_json IS after_json", [id]);
    // The first shared-settings row establishes the baseline; deleting it would
    // not restore device settings and is not a user-edit inverse.
    await db.execute("DELETE FROM operation_history_changes WHERE operation_id=? AND table_name='sync_settings' AND before_json IS NULL", [id]);
    await db.execute("DELETE FROM operation_history WHERE id=? AND NOT EXISTS (SELECT 1 FROM operation_history_changes WHERE operation_id=?)", [id, id]);
    return result;
  });
}
