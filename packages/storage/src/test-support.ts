/**
 * Test-support entry point (`@chronoeon/storage/test`). Production code must
 * not import this module; it pulls the wa-sqlite dev-dependency into the
 * bundle only for test environments.
 */
export { MemorySqliteBackend } from "./persistence/MemorySqliteBackend";
export { ensureMigrated, verifyIntegrity, RUNTIME_PRAGMAS, SCHEMA_VERSION, MIGRATION_STEPS } from "./migrations";
export { SCHEMA_SQL, SCHEMA_V2_SQL } from "./schema/schemaSql";
export { StorageError, isStorageError } from "./errors";
