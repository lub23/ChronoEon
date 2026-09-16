import { nextTimestamp } from "./persistence/timestamp";
import { runDatabaseOperation, notifyLocalChange } from "./persistence/coordinator";
import { createEntryId, isStableEntryId, type Entry, type EntryKind } from "@chronoeon/domain";
import type { EntryQuery, EntryRepositoryEvent, EntryStore } from "@chronoeon/ports";
import { StorageError } from "./errors";
import type { PersistencePort, SqlParam, SqlValue } from "./persistence/PersistencePort";
import { ensureMigrated, RUNTIME_PRAGMAS, verifyIntegrity } from "./migrations";

export interface EntryRow extends Record<string, SqlValue> {}

export interface AttachmentRowInput {
  id: string;
  entryId: string;
  /** Only the ingest queue may contain a source path; synced metadata stores SHA-256. */
  sourcePath?: string;
  sha256?: string;
  kind: "image" | "file";
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  mime?: string | null;
  caption?: string | null;
  sort?: number;
  fileMissing?: number;
  createdAt?: string;
}

export interface SeedBatch {
  entries: Entry[];
  attachments: AttachmentRowInput[];
  meta: { importId: string; importedAt: string };
}

export interface SeedMeta {
  importId: string | null;
  lastImportedAt: string | null;
}

export interface DeletedEntrySummary {
  id: string;
  entry: Entry;
  deletedAt: string;
}

interface DeletedAttachmentRow {
  id: string;
  entry_id: string;
  sha256: string | null;
  kind: "image" | "file";
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime: string | null;
  caption: string | null;
  sort: number;
  file_missing: number;
  created_at: string;
  source_path: string | null;
}

interface DeletedEntryPayload {
  entry: Entry;
  attachments: DeletedAttachmentRow[];
}

interface EntryColumns {
  id: string;
  modality: string;
  title: string;
  title_zh: string | null;
  note: string | null;
  status: string | null;
  done_at: string | null;
  cancelled_at: string | null;
  priority: string | null;
  urgency: string | null;
  location: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  end_date: string | null;
  all_day: number;
  amount: number | null;
  currency: string;
  category: string | null;
  payment: string | null;
  calendar: string | null;
  color: string | null;
  recurrence: string | null;
  recurring_days: string | null;
  recurring_end: string | null;
  recurrence_exceptions: string | null;
  recurrence_moves: string | null;
  reminder: string | null;
  created_at: string;
  updated_at: string | null;
}

const ENTRY_COLUMNS = [
  "id", "modality", "title", "title_zh", "note", "status", "done_at", "cancelled_at",
  "priority", "urgency", "location", "date", "start_time", "end_time", "end_date", "all_day",
  "amount", "currency", "category", "payment", "calendar", "color", "recurrence",
  "recurring_days", "recurring_end", "recurrence_exceptions", "recurrence_moves", "reminder",
  "created_at", "updated_at",
] as const;

const ALIASED_ENTRY_COLUMNS = ENTRY_COLUMNS.map((column) => `e.${column}`).join(", ");

const TAG_COLUMNS = ["entry_id", "tag"] as const;

const ATTACHMENT_COLUMNS = [
  "id", "entry_id", "sha256", "kind", "width", "height", "bytes", "mime", "caption",
  "sort", "file_missing", "created_at",
] as const;

function jsonOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function parseJson<T>(value: SqlValue | undefined): T | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function entryToRow(entry: Entry, updatedAt: string | null = null): Record<string, SqlParam> {
  return {
    id: entry.id,
    modality: entry.kind,
    title: entry.title,
    title_zh: entry.titleZh ?? null,
    note: entry.note ?? null,
    status: entry.status ?? null,
    done_at: entry.doneAt ?? null,
    cancelled_at: entry.cancelledAt ?? null,
    priority: entry.kind === "idea" ? null : entry.priority ?? null,
    urgency: entry.kind === "idea" ? null : entry.urgency ?? null,
    location: entry.location ?? null,
    date: entry.date,
    start_time: entry.start ?? null,
    end_time: entry.end ?? null,
    end_date: entry.endDate ?? null,
    all_day: entry.allDay ? 1 : 0,
    amount: entry.amount ?? null,
    currency: entry.currency ?? null,
    category: entry.category ?? null,
    payment: entry.payment ?? null,
    calendar: entry.calendar ?? null,
    color: entry.color ?? null,
    recurrence: entry.recurrence && entry.recurrence !== "none" ? entry.recurrence : null,
    recurring_days: jsonOrNull(entry.recurringDays),
    recurring_end: entry.recurringEnd ?? null,
    recurrence_exceptions: jsonOrNull(entry.recurrenceExceptions),
    recurrence_moves: jsonOrNull(entry.recurrenceMoves),
    reminder: entry.reminder ?? null,
    created_at: entry.createdAt,
    updated_at: updatedAt,
  };
}

function rowToEntry(row: EntryColumns, tags: string[], images: string[]): Entry {
  return {
    id: String(row.id),
    kind: row.modality as EntryKind,
    title: row.title,
    titleZh: row.title_zh ?? undefined,
    note: row.note ?? undefined,
    status: (row.status ?? undefined) as Entry["status"],
    doneAt: row.done_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    priority: row.modality === "idea" ? undefined : (row.priority ?? undefined) as Entry["priority"],
    urgency: row.modality === "idea" ? undefined : (row.urgency ?? undefined) as Entry["urgency"],
    location: row.location ?? undefined,
    date: row.date,
    start: row.start_time ?? undefined,
    end: row.end_time ?? undefined,
    endDate: row.end_date ?? undefined,
    allDay: row.all_day === 1,
    amount: typeof row.amount === "number" ? row.amount : undefined,
    currency: row.currency || undefined,
    category: row.category ?? "",
    payment: row.payment ?? undefined,
    calendar: row.calendar ?? undefined,
    color: row.color ?? "#8b8b83",
    recurrence: (row.recurrence ?? "none") as Entry["recurrence"],
    recurringDays: parseJson<number[]>(row.recurring_days),
    recurringEnd: row.recurring_end ?? undefined,
    recurrenceExceptions: parseJson<Entry["recurrenceExceptions"]>(row.recurrence_exceptions),
    recurrenceMoves: parseJson<Entry["recurrenceMoves"]>(row.recurrence_moves),
    reminder: (row.reminder ?? undefined) as Entry["reminder"],
    tags: tags.length ? tags : undefined,
    images: images.length ? images : undefined,
    createdAt: row.created_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

interface WhereClause {
  sql: string;
  params: SqlParam[];
}

function buildWhere(query: EntryQuery): WhereClause {
  const conditions: string[] = [];
  const params: SqlParam[] = [];
  const add = (sql: string, ...values: SqlParam[]): void => {
    conditions.push(sql);
    params.push(...values);
  };

  if (query.to) add("e.date <= ?", query.to);
  if (query.from) add("(e.end_date IS NULL OR e.end_date >= ?)", query.from);
  if (query.kinds?.length) add(`e.modality IN (${query.kinds.map(() => "?").join(", ")})`, ...query.kinds);
  if (query.calendarIds?.length) add(`COALESCE(e.calendar, 'default') IN (${query.calendarIds.map(() => "?").join(", ")})`, ...query.calendarIds);
  if (query.categories?.length) add(`e.category IN (${query.categories.map(() => "?").join(", ")})`, ...query.categories);

  const search = query.search?.trim() ?? "";
  if (search) {
    // Substring search over title/titleZh/note/location/tags,
    // case-insensitive for ASCII.
    const like = `%${escapeLike(search.toLocaleLowerCase())}%`;
    add(`(
      lower(e.title) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(e.title_zh, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(e.note, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(e.location, '')) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM entry_tags t WHERE t.entry_id = e.id AND lower(t.tag) LIKE ? ESCAPE '\\')
    )`, like, like, like, like, like);
  }

  return { sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

async function insertRow(
  backend: PersistencePort,
  table: string,
  columns: readonly string[],
  values: SqlParam[],
): Promise<void> {
  const placeholders = values.map(() => "?").join(", ");
  await backend.execute(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`, values);
}

async function upsertRow(
  backend: PersistencePort,
  table: string,
  columns: readonly string[],
  values: SqlParam[],
): Promise<void> {
  const placeholders = values.map(() => "?").join(", ");
  const updates = columns.filter((column) => column !== "id").map((column) => `${column}=excluded.${column}`).join(", ");
  await backend.execute(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
    values,
  );
}

function chunksOf<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * SQLite-backed implementation of `EntryStore`. One row per entry or
 * recurrence series; occurrences stay virtual (projected by
 * `@chronoeon/domain > calendar.ts`). Revision strings are `"v1:<updated_at>"`.
 */
export class SqliteEntryStore implements EntryStore {
  private readonly listeners = new Set<(event: EntryRepositoryEvent) => void>();
  constructor(private readonly backend: PersistencePort) {}

  private runOp<T>(work: () => Promise<T>): Promise<T> {
    return runDatabaseOperation(this.backend, work);
  }

  /** Open path: pragmas, migration, integrity check. */
  static async create(backend: PersistencePort): Promise<SqliteEntryStore> {
    for (const pragma of RUNTIME_PRAGMAS) {
      await backend.execute(pragma);
    }
    await ensureMigrated(backend);
    await verifyIntegrity(backend);
    return new SqliteEntryStore(backend);
  }

  async list(query: EntryQuery = {}): Promise<Entry[]> {
    return this.runOp(async () => {
      const where = buildWhere(query);
      const rows = await this.backend.select<EntryColumns>(
        `SELECT ${ALIASED_ENTRY_COLUMNS} FROM entries e ${where.sql} ORDER BY e.date, e.start_time, e.id`,
        where.params,
      );
      return this.hydrate(rows);
    });
  }

  async get(id: string): Promise<Entry | null> {
    return this.runOp(() => this.getDirect(id));
  }

  private async getDirect(id: string): Promise<Entry | null> {
      const rows = await this.backend.select<EntryColumns>(`SELECT ${ENTRY_COLUMNS.join(", ")} FROM entries WHERE id = ?`, [id]);
      const row = rows[0];
      if (!row) return null;
      const [entry] = await this.hydrate([row]);
      return entry ?? null;
  }

  async create(entry: Entry): Promise<Entry> {
    return this.createEntry(entry);
  }

  /** The entry and removal of its live timer are one durable transaction. */
  async createFromTimer(entry: Entry, sessionId: string): Promise<Entry> {
    return this.createEntry(entry, sessionId);
  }

  private async createEntry(entry: Entry, timerSessionId?: string): Promise<Entry> {
    return this.runOp(async () => {
      const id = isStableEntryId(entry.id) ? entry.id : createEntryId();
      const stored: Entry = { ...entry, id };
      await this.backend.transaction(async () => {
        if (timerSessionId) {
          const rows = await this.backend.select<{ payload_json: string }>("SELECT payload_json FROM timer_session WHERE id = ?", ["active"]);
          if (!rows[0] || JSON.parse(rows[0].payload_json).id !== timerSessionId) throw new StorageError("PersistenceFailed", "The active timer changed before it could be saved");
        }
        const row = entryToRow(stored);
        await insertRow(this.backend, "entries", Object.keys(row), Object.values(row));
        await this.replaceTags(id, entry.tags ?? []);
        await this.replaceAttachmentRows(id, entry.images ?? []);
        if (timerSessionId) await this.backend.execute("DELETE FROM timer_session WHERE id = ?", ["active"]);
      });
      const created = await this.getDirect(id);
      if (!created) throw new StorageError("PersistenceFailed", `Entry ${id} could not be read back after insert`);
      this.emit({ type: "created", snapshot: { entry: created, revision: await this.revisionOf(id) } });
      return created;
    });
  }

  async update(entry: Entry, options?: { expectedUpdatedAt?: string }): Promise<Entry> {
    return this.runOp(async () => {
      const id = entry.id;
      await this.backend.transaction(async () => {
        const rows = await this.backend.select<{ updated_at: string | null }>(
          "SELECT updated_at FROM entries WHERE id = ?", [id],
        );
        const existing = rows[0];
        if (!existing) throw new StorageError("EntryNotFound", `Entry ${id} does not exist`);
        // Accept both the raw ISO value and the "v1:<iso>" revision emitted by events.
        const expected = options?.expectedUpdatedAt?.startsWith("v1:") ? options.expectedUpdatedAt.slice(3) : options?.expectedUpdatedAt;
        if (expected !== undefined && existing.updated_at !== expected) {
          throw new StorageError(
            "RevisionMismatch",
            `Entry ${id} changed since it was read (expected ${expected}, found ${String(existing.updated_at)})`
          );
        }
        const row = entryToRow(entry, nextTimestamp(existing.updated_at));
        const assignable = Object.keys(row).filter((column) => column !== "id");
        await this.backend.execute(
          `UPDATE entries SET ${assignable.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
          [...assignable.map((column) => row[column]), id],
        );
        await this.replaceTags(id, entry.tags ?? []);
        await this.replaceAttachmentRows(id, entry.images ?? []);
      });
      const updated = await this.getDirect(id);
      if (!updated) throw new StorageError("PersistenceFailed", `Entry ${id} could not be read back after update`);
      this.emit({ type: "updated", snapshot: { entry: updated, revision: await this.revisionOf(id) } });
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.runOp(async () => {
      await this.backend.transaction(async () => {
        const rows = await this.backend.select<EntryColumns>(`SELECT ${ENTRY_COLUMNS.join(", ")} FROM entries WHERE id = ?`, [id]);
        if (!rows[0]) throw new StorageError("EntryNotFound", `Entry ${id} does not exist`);
        const [entry] = await this.hydrate([rows[0]]);
        if (!entry) throw new StorageError("PersistenceFailed", `Entry ${id} could not be snapshotted`);
        const attachments = await this.backend.select<DeletedAttachmentRow>(
          `SELECT a.id, a.entry_id, a.sha256, a.kind, a.width, a.height, a.bytes, a.mime, a.caption,
                  a.sort, a.file_missing, a.created_at, q.source_path
             FROM attachments a
             LEFT JOIN attachment_ingest_queue q ON q.attachment_id = a.id
            WHERE a.entry_id = ?
            ORDER BY a.sort, a.id`,
          [id],
        );
        const payload: DeletedEntryPayload = { entry, attachments };
        await this.backend.execute(
          "INSERT INTO deleted_entries(id,payload_json,deleted_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, deleted_at=excluded.deleted_at",
          [id, JSON.stringify(payload), new Date().toISOString()],
        );
        await this.backend.execute("DELETE FROM entries WHERE id = ?", [id]);
      });
      this.emit({ type: "deleted", id, revision: "" });
    });
  }

  /** Recent local deletes, newest first. Cleared when a sync snapshot lands. */
  async deletedEntries(): Promise<DeletedEntrySummary[]> {
    return this.runOp(async () => {
      const rows = await this.backend.select<{ id: string; payload_json: string; deleted_at: string }>(
        "SELECT id, payload_json, deleted_at FROM deleted_entries ORDER BY deleted_at DESC, id",
      );
      const result: DeletedEntrySummary[] = [];
      for (const row of rows) {
        try {
          const payload = JSON.parse(row.payload_json) as DeletedEntryPayload;
          if (payload?.entry?.id === row.id) result.push({ id: row.id, entry: payload.entry, deletedAt: row.deleted_at });
        } catch {
          // Ignore an unreadable recovery row rather than blocking the rest of the bin.
        }
      }
      return result;
    });
  }

  /** Restore a recent delete, including attachment IDs and missing-file state. */
  async restoreDeleted(id: string): Promise<Entry> {
    return this.runOp(async () => {
      await this.backend.transaction(async () => {
        const rows = await this.backend.select<{ payload_json: string }>(
          "SELECT payload_json FROM deleted_entries WHERE id = ?", [id],
        );
        if (!rows[0]) throw new StorageError("EntryNotFound", `Deleted entry ${id} is no longer recoverable`);
        const payload = JSON.parse(rows[0].payload_json) as DeletedEntryPayload;
        const entryRow = entryToRow(payload.entry);
        await upsertRow(this.backend, "entries", Object.keys(entryRow), Object.values(entryRow));
        await this.replaceTags(id, payload.entry.tags ?? []);
        for (const attachment of payload.attachments ?? []) {
          await upsertRow(this.backend, "attachments", ATTACHMENT_COLUMNS, [
            attachment.id, attachment.entry_id, attachment.sha256, attachment.kind,
            attachment.width, attachment.height, attachment.bytes, attachment.mime,
            attachment.caption, attachment.sort, attachment.file_missing, attachment.created_at,
          ]);
          if (attachment.source_path) {
            await this.backend.execute(
              "INSERT INTO attachment_ingest_queue(attachment_id,source_path) VALUES (?,?) ON CONFLICT(attachment_id) DO UPDATE SET source_path=excluded.source_path",
              [attachment.id, attachment.source_path],
            );
          }
        }
        await this.backend.execute("DELETE FROM deleted_entries WHERE id = ?", [id]);
      });
      const restored = await this.getDirect(id);
      if (!restored) throw new StorageError("PersistenceFailed", `Entry ${id} could not be restored`);
      this.emit({ type: "created", snapshot: { entry: restored, revision: await this.revisionOf(id) } });
      return restored;
    });
  }

  /** Drop all recovery snapshots after the remote history has been compacted. */
  clearDeletedEntries(): Promise<void> {
    return this.runOp(() => this.backend.execute("DELETE FROM deleted_entries"));
  }

  subscribe(listener: (event: EntryRepositoryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async isEmpty(): Promise<boolean> { return this.runOp(() => this.isEmptyDirect()); }

  private async isEmptyDirect(): Promise<boolean> {
    const rows = await this.backend.select<{ count: number }>("SELECT COUNT(*) AS count FROM entries");
    return Number(rows[0]?.count ?? 0) === 0;
  }

  async getSeedMeta(): Promise<SeedMeta> { return this.runOp(() => this.getSeedMetaDirect()); }

  private async getSeedMetaDirect(): Promise<SeedMeta> {
    const rows = await this.backend.select<{ import_id: string | null; last_imported_at: string | null }>(
      "SELECT import_id, last_imported_at FROM schema_meta WHERE key = 'seed'"
    );
    return rows[0]
      ? { importId: rows[0].import_id, lastImportedAt: rows[0].last_imported_at }
      : { importId: null, lastImportedAt: null };
  }

  /**
   * Seed-only bulk import: one transaction for the whole vault, no images sync.
   * `merge` upserts entries by id (the import dialog's re-import semantics) and
   * replaces the imported entries' tags/attachments; without it, the initial
   * seeding guards (same-vault skip, different-vault refusal) apply.
   */
  async bulkSeed(batch: SeedBatch, options: { merge?: boolean } = {}): Promise<void> {
    await this.runOp(async () => {
      await this.backend.transaction(async () => {
        const meta = await this.getSeedMetaDirect();
        if (!options.merge && meta.importId && meta.importId !== batch.meta.importId) {
          throw new StorageError(
            "ImportSourceMismatch",
            `The database was seeded from a different vault (${meta.importId.slice(0, 12)}… vs ${batch.meta.importId.slice(0, 12)}…)`
          );
        }
        if (options.merge && batch.entries.length) {
          const ids = batch.entries.map((entry) => entry.id);
          const idPlaceholders = ids.map(() => "?").join(", ");
          // Replace semantics: tags and attachments of the imported entries are
          // re-synced from the vault snapshot, so drop the existing child rows first.
          await this.backend.execute(`DELETE FROM entry_tags WHERE entry_id IN (${idPlaceholders})`, ids);
          await this.backend.execute(`DELETE FROM attachments WHERE entry_id IN (${idPlaceholders})`, ids);
        }
        const assignable = ENTRY_COLUMNS.filter((column) => column !== "id");
        const upsertAssignments = assignable.map((column) => `${column} = excluded.${column}`).join(", ");
        const entryPlaceholders = ENTRY_COLUMNS.map(() => "?").join(", ");
        for (const chunk of chunksOf(batch.entries, 250)) {
          const tuples = chunk.map(() => `(${entryPlaceholders})`).join(", ");
          const values = chunk.flatMap((entry) => Object.values(entryToRow(entry)));
          await this.backend.execute(
            `INSERT INTO entries (${ENTRY_COLUMNS.join(", ")}) VALUES ${tuples} ON CONFLICT(id) DO UPDATE SET ${upsertAssignments}`,
            values,
          );
        }
        for (const chunk of chunksOf(
          batch.entries.flatMap((entry) => [...new Set((entry.tags ?? []).filter(Boolean))].map((tag, position) => [entry.id, tag, position])),
          400,
        )) {
          const tuples = chunk.map(() => "(?, ?, ?)").join(", ");
          await this.backend.execute(`INSERT INTO entry_tags (entry_id, tag, position) VALUES ${tuples}`, chunk.flat());
        }
        for (const chunk of chunksOf(batch.attachments, 250)) {
          const tuples = chunk.map(() => `(${ATTACHMENT_COLUMNS.map(() => "?").join(", ")})`).join(", ");
          const values = chunk.flatMap((attachment) => [
            attachment.id, attachment.entryId, attachment.sha256 ?? null, attachment.kind,
            attachment.width ?? null, attachment.height ?? null, attachment.bytes ?? null,
            attachment.mime ?? null, attachment.caption ?? null, attachment.sort ?? 0,
            attachment.sha256 ? (attachment.fileMissing ?? 0) : 1, attachment.createdAt ?? new Date().toISOString(),
          ]);
          await this.backend.execute(`INSERT INTO attachments (${ATTACHMENT_COLUMNS.join(", ")}) VALUES ${tuples}`, values);
        }
        for (const attachment of batch.attachments) {
          if (!attachment.sha256 && attachment.sourcePath) await this.backend.execute(
            "INSERT INTO attachment_ingest_queue(attachment_id, source_path) VALUES (?, ?) ON CONFLICT(attachment_id) DO UPDATE SET source_path=excluded.source_path",
            [attachment.id, attachment.sourcePath]);
        }
        await this.backend.execute(
          "INSERT INTO schema_meta (key, import_id, last_imported_at) VALUES ('seed', ?, ?) ON CONFLICT(key) DO UPDATE SET import_id = excluded.import_id, last_imported_at = excluded.last_imported_at",
          [batch.meta.importId, batch.meta.importedAt],
        );
      });
      notifyLocalChange(this.backend);
    });
  }

  private async revisionOf(id: string): Promise<string> {
    const rows = await this.backend.select<{ updated_at: string | null }>("SELECT updated_at FROM entries WHERE id = ?", [id]);
    return `v1:${rows[0]?.updated_at ?? ""}`;
  }

  /** Raw `updated_at` per id (the value `update({ expectedUpdatedAt })` compares). */
  async readRevisions(ids: string[]): Promise<Map<string, string>> {
    return this.runOp(async () => {
      const revisions = new Map<string, string>();
      if (!ids.length) return revisions;
      const placeholders = ids.map(() => "?").join(", ");
      const rows = await this.backend.select<{ id: string; updated_at: string | null }>(
        `SELECT id, updated_at FROM entries WHERE id IN (${placeholders})`, ids,
      );
      for (const row of rows) {
        if (row.updated_at) revisions.set(row.id, row.updated_at);
      }
      return revisions;
    });
  }

  private async hydrate(rows: EntryColumns[]): Promise<Entry[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => String(row.id));
    const idPlaceholders = ids.map(() => "?").join(", ");
    const tagRows = await this.backend.select<{ entry_id: string; tag: string }>(
      `SELECT entry_id, tag FROM entry_tags WHERE entry_id IN (${idPlaceholders}) ORDER BY position, tag`, ids,
    );
    const attachmentRows = await this.backend.select<{ entry_id: string; id: string; sha256: string | null }>(
      `SELECT entry_id, id, sha256 FROM attachments WHERE entry_id IN (${idPlaceholders}) ORDER BY entry_id, sort, id`, ids,
    );
    const tagsByEntry = new Map<string, string[]>();
    for (const row of tagRows) {
      const list = tagsByEntry.get(row.entry_id) ?? [];
      list.push(row.tag);
      tagsByEntry.set(row.entry_id, list);
    }
    const imagesByEntry = new Map<string, string[]>();
    for (const row of attachmentRows) {
      const list = imagesByEntry.get(row.entry_id) ?? [];
      list.push(attachmentReference(row));
      imagesByEntry.set(row.entry_id, list);
    }
    return rows.map((row) => rowToEntry(row, tagsByEntry.get(String(row.id)) ?? [], imagesByEntry.get(String(row.id)) ?? []));
  }

  private async replaceTags(entryId: string, tags: string[]): Promise<void> {
    await this.backend.execute("DELETE FROM entry_tags WHERE entry_id = ?", [entryId]);
    let position = 0;
    for (const tag of [...new Set(tags.filter(Boolean))]) {
      await this.backend.execute("INSERT INTO entry_tags (entry_id, tag, position) VALUES (?, ?, ?)", [entryId, tag, position]);
      position += 1;
    }
  }

  private async replaceAttachmentRows(entryId: string, images: string[]): Promise<void> {
    const existing = await this.backend.select<{ id: string; sha256: string | null }>(
      "SELECT id, sha256 FROM attachments WHERE entry_id = ?", [entryId]);
    const byReference = new Map(existing.map((row) => [attachmentReference(row), row]));
    const kept = new Set<string>();
    for (const [sort, reference] of [...new Set(images.filter(Boolean))].entries()) {
      const row = byReference.get(reference);
      if (row) {
        kept.add(row.id);
        await this.backend.execute("UPDATE attachments SET sort = ? WHERE id = ?", [sort, row.id]);
      } else {
        const sha256 = /^attachments\/([a-f0-9]{64})\.webp$/.exec(reference)?.[1];
        if (!sha256) throw new StorageError("PersistenceFailed", "Images must be imported as content-addressed WebP before saving");
        await insertRow(this.backend, "attachments", ATTACHMENT_COLUMNS, [
          createEntryId(), entryId, sha256, "image", null, null, null, "image/webp", null, sort, 0, new Date().toISOString(),
        ]);
      }
    }
    for (const row of existing) if (!kept.has(row.id)) await this.backend.execute("DELETE FROM attachments WHERE id = ?", [row.id]);
  }

  /** Notify disposable UI caches after a logical remote apply (the pool stays open). */
  notifyRebuilt(): void { this.emit({ type: "rebuilt" }); }

  private emit(event: EntryRepositoryEvent): void {
    if (event.type !== "rebuilt") notifyLocalChange(this.backend);
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

function attachmentReference(row: { id: string; sha256: string | null }): string {
  return `attachments/${row.sha256 ?? `missing-${row.id}`}.webp`;
}
