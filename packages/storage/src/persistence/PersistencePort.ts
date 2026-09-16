/** SQL bind/result scalar superset shared by both backends. */
export type SqlParam = string | number | bigint | null | Uint8Array | boolean;
export type SqlValue = string | number | bigint | null | Uint8Array;

/**
 * Minimal SQL surface both the Tauri plugin (`tauri-plugin-sql`) and the
 * in-memory test adapter (wa-sqlite MemoryVFS) can implement. No file IO,
 * no Tauri types: the storage package stays backend-agnostic.
 */
export interface PersistencePort {
  /** Run one or more statements; no rows returned. */
  execute(sql: string, params?: SqlParam[]): Promise<void>;
  /** Run a query and return its rows as plain objects keyed by column name. */
  select<T = Record<string, SqlValue>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Run `work` inside one transaction; roll back on throw. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  /** Close the underlying handle. */
  close(): Promise<void>;
}
