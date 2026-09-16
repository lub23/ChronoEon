export type StorageErrorCode =
  | "PersistenceFailed"
  | "SchemaVersionUnsupported"
  | "ImportSourceUnavailable"
  | "ImportSourceMismatch"
  | "EntryNotFound"
  | "RevisionMismatch"
  | "CorruptionDetected";

/**
 * Typed storage-layer error. The app maps `code` to bilingual i18n strings;
 * the storage package itself carries no UI strings.
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, public readonly detail?: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError
    || (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "StorageError");
}
