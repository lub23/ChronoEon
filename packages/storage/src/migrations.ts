import type { PersistencePort } from "./persistence/PersistencePort";
import { StorageError } from "./errors";
import { SCHEMA_SQL, SCHEMA_V2_SQL, SCHEMA_V3_SQL, SCHEMA_V4_SQL, SCHEMA_V5_SQL, SCHEMA_V6_SQL, SCHEMA_V7_SQL, SCHEMA_V8_SQL, SCHEMA_V9_SQL, SCHEMA_V10_SQL } from "./schema/schemaSql";

export interface MigrationStep {
  version: number;
  sql: string;
}

/** Append-only migration steps; each applies in its own transaction. */
export const MIGRATION_STEPS: MigrationStep[] = [
  { version: 1, sql: SCHEMA_SQL },
  { version: 2, sql: SCHEMA_V2_SQL },
  { version: 3, sql: SCHEMA_V3_SQL },
  { version: 4, sql: SCHEMA_V4_SQL },
  { version: 5, sql: SCHEMA_V5_SQL },
  { version: 6, sql: SCHEMA_V6_SQL },
  { version: 7, sql: SCHEMA_V7_SQL },
  { version: 8, sql: SCHEMA_V8_SQL },
  { version: 9, sql: SCHEMA_V9_SQL },
  { version: 10, sql: SCHEMA_V10_SQL },
];

export const SCHEMA_VERSION = MIGRATION_STEPS[MIGRATION_STEPS.length - 1].version;

/** Pragmas applied on every backend open; identical on Tauri and in-memory paths. */
export const RUNTIME_PRAGMAS: string[] = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA foreign_keys = ON",
  "PRAGMA temp_store = MEMORY",
];

/**
 * Migration runner. Each pending step applies inside its own transaction and
 * bumps `PRAGMA user_version`; a database whose version is newer than this
 * code refuses to open (forward-compat guard).
 */
export async function ensureMigrated(backend: PersistencePort, steps: MigrationStep[] = MIGRATION_STEPS): Promise<void> {
  const rows = await backend.select<{ user_version: number }>("PRAGMA user_version");
  const current = rows[0]?.user_version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new StorageError(
      "SchemaVersionUnsupported",
      `Database user_version ${current} is newer than the supported version ${SCHEMA_VERSION}.`
    );
  }
  for (const step of steps) {
    if (current >= step.version) continue;
    await backend.transaction(async () => {
      await backend.execute(step.sql);
      await backend.execute(`PRAGMA user_version = ${step.version}`);
    });
  }
}

/** Boot-time corruption gate; throws CorruptionDetected when SQLite reports anything but "ok". */
export async function verifyIntegrity(backend: PersistencePort): Promise<void> {
  const rows = await backend.select<{ integrity_check: string }>("PRAGMA integrity_check");
  const verdict = rows.map((row) => row.integrity_check).join("\n");
  if (rows.length !== 1 || rows[0].integrity_check !== "ok") {
    throw new StorageError("CorruptionDetected", `SQLite integrity_check failed: ${verdict}`);
  }
}
