export { SqliteEntryStore } from "./SqliteEntryStore";
export type { AttachmentRowInput, DeletedEntrySummary, SeedBatch, SeedMeta } from "./SqliteEntryStore";
export { StorageError, isStorageError } from "./errors";
export type { StorageErrorCode } from "./errors";
export { ensureMigrated, verifyIntegrity, RUNTIME_PRAGMAS, SCHEMA_VERSION, MIGRATION_STEPS } from "./migrations";
export type { MigrationStep } from "./migrations";
export { TimerStore } from "./timer/TimerStore";
export { TauriSqliteBackend } from "./persistence/TauriSqliteBackend";
export type { PersistencePort, SqlParam, SqlValue } from "./persistence/PersistencePort";
export { seedVaultToStore } from "./seed/seed";
export type { SeedAttachmentCopier, SeedOptions, SeedResult } from "./seed/seed";
export { previewVaultMigration, deterministicEntryId, deterministicAttachmentId, attachmentDestination } from "./seed/previewVaultMigration";
export type {
  EntryChangeNote,
  EntryChangeNoteKind,
  MigrationAttachmentPreview,
  MigrationEntryPreview,
  MigrationPreview,
  MigrationPreviewOptions,
} from "./seed/previewVaultMigration";
export { computeVaultImportId } from "./seed/seedIdempotency";
export { AiConversationStore } from "./ai/aiConversationStore";
export type {
  AiConversation,
  AiConversationMode,
  AiConversationProviderKind,
  AiMessageRecord,
  AiMessageRole,
  NewAiConversation,
  NewAiMessage,
  AiCaptureReviewRecord,
} from "./ai/aiConversationStore";

export { SyncStore } from "./sync/SyncStore";
export type { SyncDocument, PendingBatch, SyncLocalStatus, AttachmentMetadata, MissingAttachmentDetail } from "./sync/SyncStore";
export * from "./sync/protocol";

export * from "./sync/SyncEngine";

export * from "./sync/snapshotPolicy";
