import Database from "@tauri-apps/plugin-sql";
import type { PersistencePort, SqlParam, SqlValue } from "./PersistencePort";

/** The subset of the plugin's Database surface the backend uses. */
interface PluginDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * Production persistence backend: a real SQLite file through the official
 * Tauri 2 plugin (sqlx under the hood). The absolute path must be passed in —
 * ChronoEon resolves `<AppLocalDataDir>/chronoeon.db` itself so the plugin's
 * default AppConfig resolution is bypassed.
 */
export class TauriSqliteBackend implements PersistencePort {
  private transactionDepth = 0;

  private constructor(private readonly db: PluginDatabase) {}

  static async open(absolutePath: string, pragmas: string[]): Promise<TauriSqliteBackend> {
    const db = await Database.load(`sqlite:${absolutePath}`) as unknown as PluginDatabase;
    const backend = new TauriSqliteBackend(db);
    for (const pragma of pragmas) {
      await backend.execute(pragma);
    }
    return backend;
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<void> {
    await this.db.execute(sql, params as unknown[]);
  }

  async select<T = Record<string, SqlValue>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.db.select<T>(sql, params as unknown[]);
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.transactionDepth === 0) {
      await this.db.execute("BEGIN IMMEDIATE");
    }
    this.transactionDepth += 1;
    try {
      const result = await work();
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0) await this.db.execute("COMMIT");
      return result;
    } catch (error) {
      this.transactionDepth = 0;
      try { await this.db.execute("ROLLBACK"); } catch { /* connection may be gone */ }
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
