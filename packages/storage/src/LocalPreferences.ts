import type { PersistencePort } from "./persistence/PersistencePort";
import { runDatabaseOperation } from "./persistence/coordinator";

/** Device settings share SQLite across WebView origins and never enter sync. */
export class LocalPreferences {
  constructor(private readonly db: PersistencePort) {}
  readAll(): Promise<Record<string, string>> {
    return runDatabaseOperation(this.db, async () => {
      const rows = await this.db.select<{ key: string; value: string }>("SELECT key,value FROM sync_meta WHERE key LIKE 'local.preference.%'");
      return Object.fromEntries(rows.map(row => [row.key.slice("local.preference.".length), row.value]));
    });
  }
  set(key: string, value: string): Promise<void> {
    JSON.parse(value);
    return runDatabaseOperation(this.db, () => this.db.execute("INSERT INTO sync_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value IS NOT excluded.value", ["local.preference." + key, value]));
  }
}
