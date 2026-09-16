import type { ChronoEonSettings } from "@chronoeon/domain";
import type { MarkdownDocument } from "@chronoeon/markdown";
import { StorageError } from "../errors";
import { SqliteEntryStore, type AttachmentRowInput } from "../SqliteEntryStore";
import {
  deterministicAttachmentId,
  previewVaultMigration,
} from "./previewVaultMigration";

/**
 * Copies a vault-relative attachment into the local attachments slot.
 * Resolve the byte count, or null when the source is missing/unreadable
 * (the row is still created with `fileMissing = 1`).
 */
export interface SeedAttachmentCopier {
  copy(sourceVaultRelativePath: string, destinationAbsolutePath: string): Promise<number | null>;
}

export interface SeedOptions {
  /** Parsed Markdown documents of the vault (read-only input; never modified). */
  documents: MarkdownDocument[];
  /** The vault root, part of the import-id replay guard. */
  vaultRoot: string;
  /** Absolute folder for local attachment copies (flat, UUID-named). */
  attachmentsRoot: string;
  attachmentCopier: SeedAttachmentCopier;
  /** Parse settings (calendars/categories); defaults to the built-in catalog. */
  settings?: ChronoEonSettings;
  /**
   * `initial` (default): first-run semantics — skip when the same vault was
   * already imported, refuse a different vault. `merge`: the import dialog's
   * semantics — always import, upserting entries by id.
   */
  mode?: "initial" | "merge";
}

export interface SeedResult {
  importedEntries: number;
  attachmentRows: number;
  missingAttachments: number;
  importId: string;
  elapsedMs: number;
  /** True when the same vault was already imported — nothing was inserted. */
  skipped: boolean;
}

/**
 * Vault→SQLite seeding importer. Consumes the same shared transformation the
 * preview UI shows (`previewVaultMigration`), so the persisted rows — ids,
 * narrowed fields and attachment destinations — are exactly what was
 * previewed. Parse-only: the vault is never modified, no stable IDs are
 * written back, and occurrences are never materialized.
 */
export async function seedVaultToStore(store: SqliteEntryStore, options: SeedOptions): Promise<SeedResult> {
  const started = performance.now();
  const merge = options.mode === "merge";

  const preview = await previewVaultMigration({
    documents: options.documents,
    vaultRoot: options.vaultRoot,
    attachmentsRoot: options.attachmentsRoot,
    settings: options.settings,
  });
  const importId = preview.importId;

  if (!merge) {
    const meta = await store.getSeedMeta();
    if (meta.importId === importId) {
      return { importedEntries: 0, attachmentRows: 0, missingAttachments: 0, importId, elapsedMs: 0, skipped: true };
    }
    if (meta.importId !== null) {
      throw new StorageError(
        "ImportSourceMismatch",
        `The database was seeded from a different vault; use the import dialog to merge instead.`
      );
    }
  }

  const entries = preview.entries.map((item) => item.entry);
  const attachmentRows: AttachmentRowInput[] = [];
  let missingAttachments = 0;

  for (const item of preview.entries) {
    let sort = 0;
    for (const attachment of item.attachments) {
      const attachmentId = await deterministicAttachmentId(item.id, attachment.source, sort);
      let bytes: number | null = null;
      try {
        bytes = await options.attachmentCopier.copy(attachment.source, attachment.destination);
      } catch {
        bytes = null;
      }
      if (bytes === null) missingAttachments += 1;
      attachmentRows.push({
        id: attachmentId,
        entryId: item.id,
        sourcePath: attachment.destination,
        kind: "image",
        bytes: bytes ?? 0,
        mime: null,
        sort,
        fileMissing: bytes === null ? 1 : 0,
        createdAt: item.entry.createdAt,
      });
      sort += 1;
    }
  }

  await store.bulkSeed(
    { entries, attachments: attachmentRows, meta: { importId, importedAt: new Date().toISOString() } },
    { merge },
  );
  return {
    importedEntries: entries.length,
    attachmentRows: attachmentRows.length,
    missingAttachments,
    importId,
    elapsedMs: performance.now() - started,
    skipped: false,
  };
}
