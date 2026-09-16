import {
  DEFAULT_CHRONOEON_SETTINGS,
  isStableEntryId,
  type ChronoEonSettings,
  type Entry,
  type EntryKind,
} from "@chronoeon/domain";
import { contentRevision, parseMarkdownDocuments, type MarkdownDocument } from "@chronoeon/markdown";
import { computeVaultImportId } from "./seedIdempotency";

/**
 * The single shared transformation behind both the import preview and the
 * seeder: parse the vault read-only and produce, for every entry, the exact
 * id, narrowed fields and attachment destinations that will be persisted.
 * The preview UI and `seed.ts` consume the same function, so they cannot
 * drift.
 */

export type EntryChangeNoteKind = "new-id" | "priority-narrowed" | "urgency-narrowed" | "unknown-fields";

export interface EntryChangeNote {
  kind: EntryChangeNoteKind;
  detail: string;
}

export interface MigrationAttachmentPreview {
  /** Vault-relative reference from the parsed entry. */
  source: string;
  /** Local path the seeder will create (UUID-named slot). */
  destination: string;
}

export interface MigrationEntryPreview {
  /** The id the source Markdown carried (`legacy-…` when none was persisted). */
  sourceId: string;
  /** The exact id the seeder will persist. */
  id: string;
  entry: Entry;
  notes: EntryChangeNote[];
  attachments: MigrationAttachmentPreview[];
}

export interface MigrationPreview {
  importId: string;
  entries: MigrationEntryPreview[];
  counts: Record<EntryKind, number>;
}

export interface MigrationPreviewOptions {
  documents: MarkdownDocument[];
  vaultRoot: string;
  attachmentsRoot: string;
  settings?: ChronoEonSettings;
}

const NARROWED_LITERALS: Record<string, "low" | "normal" | "high"> = {
  lowest: "low",
  medium: "normal",
  highest: "high",
};

export function safeAttachmentExtension(value: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(value);
  return match ? match[1].toLowerCase() : "bin";
}

/** The field content that distinguishes two parsed entries from each other. */
export function entryIdSeedBase(source: Entry): string {
  return [
    source.markdown?.path ?? "",
    source.kind,
    source.title,
    source.date,
    source.start ?? "",
    source.end ?? "",
    source.endDate ?? "",
    String(source.amount ?? ""),
    source.category ?? "",
    source.note ?? "",
    source.location ?? "",
    source.status ?? "",
  ].join(":");
}

/**
 * Deterministic UUID for a legacy-derived entry. Seeded by every
 * distinguishing field (path, kind, title, date, start/end, amount, category,
 * note, location, status), hashed with SHA-256 so the 128-bit id space has no
 * practical collisions. Identical lines within one file are disambiguated by
 * their occurrence index (appended as `#n`, n > 0), so re-importing the same
 * vault maps every legacy entry to the same primary key — duplicate-free
 * under merge mode — while remaining stable across unrelated line edits.
 */
export async function deterministicEntryId(source: Entry, duplicateIndex = 0): Promise<string> {
  const base = entryIdSeedBase(source);
  const seed = duplicateIndex > 0 ? `${base}#${duplicateIndex}` : base;
  const hex = await contentRevision(seed);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Build the local attachment slot path for a parsed vault-relative reference. */
export function attachmentDestination(attachmentsRoot: string, attachmentId: string, source: string): string {
  return `${attachmentsRoot.replace(/[\\/]+$/, "")}/${attachmentId}.${safeAttachmentExtension(source)}`;
}

/**
 * Deterministic attachment slot id, derived from the entry id, the vault
 * reference and its position. The preview and the seeder both compute it, so
 * the displayed destinations are exactly the paths the import writes — and
 * re-importing the same vault reuses the same slots.
 */
export async function deterministicAttachmentId(entryId: string, source: string, index: number): Promise<string> {
  const hex = await contentRevision(`${entryId}:${index}:${source}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function previewVaultMigration(options: MigrationPreviewOptions): Promise<MigrationPreview> {
  const importId = await computeVaultImportId(options.vaultRoot, options.documents);
  const parsed = parseMarkdownDocuments(options.documents, { settings: options.settings ?? DEFAULT_CHRONOEON_SETTINGS });
  const counts: Record<EntryKind, number> = { task: 0, event: 0, bill: 0, idea: 0 };
  const entries: MigrationEntryPreview[] = [];
  // Occurrence index per identical seed line within the same file, so
  // byte-identical duplicate lines stay distinct rows under merge imports.
  const duplicateCounts = new Map<string, number>();

  for (const source of parsed) {
    // Stable-ID carving: keep a parsed `[id:: …]`. Legacy-derived ids become a
    // deterministic UUID — the same value the seeder will persist.
    let id = source.id;
    if (!isStableEntryId(source.id)) {
      const baseSeed = entryIdSeedBase(source);
      const index = duplicateCounts.get(baseSeed) ?? 0;
      duplicateCounts.set(baseSeed, index + 1);
      id = await deterministicEntryId(source, index);
    }
    const notes: EntryChangeNote[] = [];
    if (!isStableEntryId(source.id)) {
      notes.push({ kind: "new-id", detail: `${source.id} → ${id}` });
    }
    const fields = source.markdown?.fields ?? {};
    if (fields.priority && fields.priority in NARROWED_LITERALS) {
      notes.push({ kind: "priority-narrowed", detail: `${fields.priority} → ${NARROWED_LITERALS[fields.priority]}` });
    }
    if (fields.urgency && fields.urgency in NARROWED_LITERALS) {
      notes.push({ kind: "urgency-narrowed", detail: `${fields.urgency} → ${NARROWED_LITERALS[fields.urgency]}` });
    }
    const unknownKeys = Object.keys(source.markdown?.unknownFields ?? {});
    if (unknownKeys.length) {
      notes.push({ kind: "unknown-fields", detail: unknownKeys.join(", ") });
    }

    const entry: Entry = { ...source, id };
    counts[entry.kind] += 1;
    const attachmentPreviews: MigrationAttachmentPreview[] = [];
    let attachmentIndex = 0;
    for (const image of source.images ?? []) {
      const attachmentId = await deterministicAttachmentId(id, image, attachmentIndex);
      attachmentPreviews.push({
        source: image,
        destination: attachmentDestination(options.attachmentsRoot, attachmentId, image),
      });
      attachmentIndex += 1;
    }
    entries.push({
      sourceId: source.id,
      id,
      entry,
      notes,
      attachments: attachmentPreviews,
    });
  }
  return { importId, entries, counts };
}
