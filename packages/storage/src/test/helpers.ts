import { MemorySqliteBackend } from "../persistence/MemorySqliteBackend";
import { SqliteEntryStore } from "../SqliteEntryStore";

/** Open a migrated, integrity-checked store over an in-memory SQLite database. */
export async function openMemoryStore(): Promise<{ backend: MemorySqliteBackend; store: SqliteEntryStore }> {
  const backend = await MemorySqliteBackend.open([]);
  const store = await SqliteEntryStore.create(backend);
  return { backend, store };
}
