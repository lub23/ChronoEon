import { nextSnapshotAt } from "./snapshotPolicy";
import { packState, unpackState } from "./stateCodec";
import { createEntryId } from "@chronoeon/domain";
import type { PersistencePort, SqlParam } from "../persistence/PersistencePort";
import { notifyLocalChange, runDatabaseOperation, subscribeLocalChanges } from "../persistence/coordinator";
import { ENTITY_TABLES } from "./entitySchema";
import { applyOperation, equal, localPatch, materialize, mergeEntity, SETTINGS_ID, stableJson, UUID, validateOperation, validateState,
  type Clock, type EntityData, type EntityKind, type EntityState, type Json, type SyncConflict, type SyncOperation } from "./protocol";

export interface SyncDocument { path: string; content: string; hash: string }
export interface PendingBatch { path: string; content: string }
export interface SnapshotCandidate { path: string; hash: string; createdAt: string }
export interface SyncLocalStatus { lastSnapshotAt: string | null; nextSnapshotAt: string | null; pending: number; conflicts: number; failures: number; nextAttempt: number; lastSuccess: string | null; lastError: string | null; missingAttachments: number }
export interface AttachmentMetadata { sha256: string; width: number; height: number; bytes: number; mime: string }
export interface MissingAttachmentDetail {
  attachmentId: string;
  entryId: string;
  entryTitle: string;
  entryDate: string;
  sha256: string | null;
  sourcePath: string | null;
}
interface Change { sequence: number; entity: EntityKind; entity_id: string; data_json: string | null; changed_at: string }
const MAX_BATCH_BYTES = 1024 * 1024;
const MAX_LINE_BYTES = 8 * 1024 * 1024;

/** Journal and semantic state share the business connection/transaction queue.
 * Triggers capture *every* business write atomically, including chat and deletes. */
export class SyncStore {
  constructor(private readonly db: PersistencePort) {}
  private run<T>(work: () => Promise<T>): Promise<T> { return runDatabaseOperation(this.db, work); }
  subscribe(listener: () => void): () => void { return subscribeLocalChanges(this.db, listener); }
  private async meta<T>(key: string, initial: T): Promise<T> {
    const rows = await this.db.select<{ value: string }>("SELECT value FROM sync_meta WHERE key=?", [key]);
    return rows.length ? JSON.parse(rows[0].value) as T : initial;
  }
  private async putMeta(key: string, value: unknown): Promise<void> {
    await this.db.execute("INSERT INTO sync_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, JSON.stringify(value)]);
  }
  private async identityDirect(): Promise<string> {
    let id = await this.meta("deviceId", "");
    if (!id) { id = createEntryId(); await this.putMeta("deviceId", id); }
    return id;
  }
  deviceId(): Promise<string> { return this.run(() => this.identityDirect()); }
  bindDataset(remoteId?: string): Promise<string> {
    return this.run(async () => {
      const current = await this.meta("datasetId", "");
      if (remoteId && current && current !== remoteId && await this.meta("datasetPublished", false)) throw new Error("SYNC_DIFFERENT_DATASET");
      const id = remoteId || current || createEntryId(); await this.putMeta("datasetId", id); return id;
    });
  }
  /** Rebuild disposable link/conflict indexes without discarding user data. */
  rebuildDerivedIndexes(): Promise<void> {
    return this.run(() => this.db.transaction(async () => {
      await this.db.execute("DELETE FROM sync_links");
      await this.db.execute("DELETE FROM sync_conflicts");
      for await (const row of this.stateRows()) await this.saveState(unpackState(JSON.parse(row.state_json)));
    }));
  }
  private async state(entity: EntityKind, id: string): Promise<EntityState | undefined> {
    const rows = await this.db.select<{ state_json: string }>("SELECT state_json FROM sync_entities WHERE entity=? AND id=?", [entity, id]);
    return rows[0] ? unpackState(JSON.parse(rows[0].state_json)) : undefined;
  }
  private async saveState(state: EntityState): Promise<void> {
    await this.db.execute("INSERT INTO sync_entities(entity,id,state_json) VALUES (?,?,?) ON CONFLICT(entity,id) DO UPDATE SET state_json=excluded.state_json", [state.entity, state.id, JSON.stringify(packState(state))]);
    await this.db.execute("DELETE FROM sync_links WHERE entity=? AND id=?", [state.entity,state.id]);
    const data = materialize(state).data;
    if (data) for (const field of ["entry_id","parent_entry_id","proposed_entry_id","conversation_id"]) {
      if (typeof data[field] === "string") await this.db.execute("INSERT OR IGNORE INTO sync_links(entity,id,parent_entity,parent_id) VALUES (?,?,?,?)",
        [state.entity,state.id,field === "conversation_id" ? "conversation" : "entry",data[field] as string]);
    }
    await this.db.execute("DELETE FROM sync_conflicts WHERE entity=? AND id=?", [state.entity, state.id]);
    for (const conflict of materialize(state).conflicts) await this.db.execute(
      "INSERT INTO sync_conflicts(entity,id,field,versions_json) VALUES (?,?,?,?)", [conflict.entity, conflict.id, conflict.field, JSON.stringify(conflict.versions)]);
  }
  private async *stateRows(where = ""): AsyncGenerator<{ state_json: string }> {
    for (let offset = 0; ; offset += 256) {
      const rows = await this.db.select<{ state_json: string }>(`SELECT state_json FROM sync_entities ${where} ORDER BY entity,id LIMIT 256 OFFSET ?`, [offset]);
      for (const row of rows) yield row;
      if (rows.length < 256) break;
    }
  }
  private async newOperation(state: EntityState | undefined, entity: EntityKind, id: string, patch: { data: EntityData; base: EntityData }, timestamp: string): Promise<SyncOperation> {
    const deviceId = await this.identityDirect();
    const sequence = (await this.meta("sequence", 0)) + 1;
    const revision = Math.max(await this.meta("lamport", 0), state?.revision ?? 0) + 1;
    const deleted = patch.data.$exists === false;
    const operation: SyncOperation = { version: 1, operationId: createEntryId(), deviceId, sequence, revision, timestamp,
      entity, id, op: deleted ? (entity === "attachment" ? "attachment.remove" : "delete")
        : !state ? (entity === "attachment" ? "attachment.add" : "create") : "update",
      context: { ...state?.clock }, ...patch };
    validateOperation(operation);
    await this.putMeta("sequence", sequence); await this.putMeta("lamport", revision);
    await this.db.execute("INSERT INTO sync_outbox(id,operation_json) VALUES (?,?)", [operation.operationId, JSON.stringify(operation)]);
    return operation;
  }
  private async flushDirect(): Promise<void> {
    const rows = await this.db.select<Change>("SELECT * FROM sync_changes ORDER BY sequence");
    const latest = new Map<string, Change>();
    for (const row of rows) latest.set(`${row.entity}/${row.entity_id}`, row);
    for (const row of latest.values()) {
      const state = await this.state(row.entity, row.entity_id);
      const data = row.data_json === null ? null : JSON.parse(row.data_json) as EntityData;
      // An object created and deleted before capture has no remote existence.
      // Its FK-cascaded children must not leak unsynced/deleted chat or photos.
      if (!state && data === null) continue;
      const parent = data && row.entity === "message" ? {entity:"conversation" as const,id:String(data.conversation_id)}
        : data && row.entity === "attachment" ? {entity:"entry" as const,id:String(data.entry_id)} : null;
      if (parent && latest.get(`${parent.entity}/${parent.id}`)?.data_json === null && !(await this.state(parent.entity,parent.id))) continue;
      const patch = localPatch(state, data);
      if (!Object.keys(patch.data).length) continue;
      const operation = await this.newOperation(state, row.entity, row.entity_id, patch, row.changed_at);
      await this.saveState(applyOperation(state, operation));
    }
    if (rows.length) await this.db.execute("DELETE FROM sync_changes WHERE sequence<=?", [rows.at(-1)!.sequence]);
  }
  flush(): Promise<void> { return this.run(() => this.db.transaction(() => this.flushDirect())); }

  /** Pack the durable outbox once. Retries reuse the same immutable batch path. */
  pack(now = new Date()): Promise<PendingBatch[]> {
    return this.run(() => this.db.transaction(async () => {
      await this.flushDirect();
      const rows = await this.db.select<{ id: string; operation_json: string }>("SELECT id,operation_json FROM sync_outbox ORDER BY rowid");
      const device = await this.identityDirect();
      let group: typeof rows = []; let bytes = 0;
      const write = async () => {
        if (!group.length) return;
        const day = now.toISOString().slice(0, 10).replaceAll("-", "/");
        const path = `sync/${day}-${device}-${createEntryId()}.jsonl.zst`;
        await this.db.execute("INSERT INTO sync_batches(path,content) VALUES (?,?)", [path, group.map((row) => row.operation_json).join("\n") + "\n"]);
        for (const row of group) await this.db.execute("DELETE FROM sync_outbox WHERE id=?", [row.id]);
        group = []; bytes = 0;
      };
      for (const row of rows) {
        const size = new TextEncoder().encode(row.operation_json).length + 1;
        if (size > MAX_LINE_BYTES) throw new Error("SYNC_ENTITY_TOO_LARGE");
        if (group.length && (bytes + size > MAX_BATCH_BYTES || group.length >= 1000)) await write();
        group.push(row); bytes += size;
      }
      await write();
      return this.db.select<PendingBatch>("SELECT path,content FROM sync_batches WHERE published=0 ORDER BY path");
    }));
  }
  snapshot(datasetId: string, now = new Date()): Promise<string> {
    return this.run(() => this.db.transaction(async () => {
      await this.flushDirect();
      const lines: string[] = []; const frontier: Clock = {};
      for await (const row of this.stateRows()) {
        const clock = (JSON.parse(row.state_json) as { clock: Clock }).clock;
        for (const [device, seq] of Object.entries(clock)) frontier[device] = Math.max(frontier[device] ?? 0, seq);
        lines.push(row.state_json);
      }
      const header = { format: "chronoeon.snapshot", version: 1, datasetId, createdAt: now.toISOString(), count: lines.length, frontier };
      return [JSON.stringify(header), ...lines].join("\n") + "\n";
    }));
  }
  knownDocuments(): Promise<Record<string, string>> {
    return this.run(async () => Object.fromEntries((await this.db.select<{ path: string; hash: string }>("SELECT path,hash FROM sync_documents")).map((row) => [row.path, row.hash])));
  }
  /** Snapshot + logs merge into local rows. Local pending writes are flushed first,
   * and neither the live connection nor the SQLite file is ever replaced. */
  applyDocuments(documents: SyncDocument[], datasetId: string): Promise<number> {
    return this.run(() => this.db.transaction(async () => {
      await this.flushDirect();
      let received = 0; let lamport = await this.meta("lamport", 0);
      const operations: SyncOperation[] = [];
      const changed = new Map<string, {entity: EntityKind; id: string}>();
      for (const document of documents) {
        const known = await this.db.select<{ hash: string }>("SELECT hash FROM sync_documents WHERE path=?", [document.path]);
        if (known[0]) { if (known[0].hash !== document.hash) throw new Error("SYNC_IMMUTABLE_OBJECT_CHANGED"); continue; }
        const lines = document.content.split("\n").filter(Boolean);
        if (lines.some((line) => new TextEncoder().encode(line).length > MAX_LINE_BYTES)) throw new Error("SYNC_ENTITY_TOO_LARGE");
        let frontier: Clock | null = null;
        if (document.path.startsWith("snapshot/")) {
          frontier = {};
          const header = JSON.parse(lines.shift() ?? "null");
          if (header?.format !== "chronoeon.snapshot" || header.version !== 1 || header.datasetId !== datasetId || header.count !== lines.length) throw new Error("Invalid logical snapshot");
          for (const line of lines) {
            const incoming = unpackState(JSON.parse(line));
            changed.set(`${incoming.entity}/${incoming.id}`, incoming);
            for (const [device, sequence] of Object.entries(incoming.clock)) frontier[device] = Math.max(frontier[device] ?? 0,sequence);
            await this.saveState(mergeEntity(await this.state(incoming.entity, incoming.id), incoming));
            lamport = Math.max(lamport, incoming.revision); received += 1;
          }
          if (!equal(header.frontier, frontier)) throw new Error("Invalid snapshot frontier");
        } else {
          for (const line of lines) { const op: unknown = JSON.parse(line); validateOperation(op); operations.push(op); }
        }
        await this.db.execute("INSERT INTO sync_documents(path,hash,frontier_json) VALUES (?,?,?)", [document.path, document.hash, frontier ? JSON.stringify(frontier) : null]);
      }
      operations.sort((a, b) => a.revision - b.revision || a.deviceId.localeCompare(b.deviceId) || a.sequence - b.sequence);
      for (const op of operations) {
        changed.set(`${op.entity}/${op.id}`, op);
        await this.saveState(applyOperation(await this.state(op.entity, op.id), op));
        lamport = Math.max(lamport, op.revision); received += 1;
      }
      await this.putMeta("lamport", lamport);
      if (received) await this.projectChanged([...changed.values()]);
      return received;
    }));
  }
  private async projectChanged(changed: Array<{entity: EntityKind; id: string}>): Promise<void> {
    const affected = new Map(changed.map((item) => [`${item.entity}/${item.id}`, item]));
    // Parent deletion/restoration must also repair its attachment/chat children.
    // Ordinary edits never rewrite the entire database or stall unrelated writes.
    const pending = [...changed];
    for (const parent of pending) {
      const children = await this.db.select<{entity: EntityKind; id: string}>("SELECT entity,id FROM sync_links WHERE parent_entity=? AND parent_id=?", [parent.entity,parent.id]);
      for (const child of children) if (!affected.has(`${child.entity}/${child.id}`)) { affected.set(`${child.entity}/${child.id}`,child); pending.push(child); }
    }
    const order: EntityKind[] = ["entry", "conversation", "attachment", "message", "settings"];
    const keys = [...affected.values()].sort((a,b) => order.indexOf(a.entity)-order.indexOf(b.entity) || a.id.localeCompare(b.id));
    await this.db.execute("UPDATE sync_control SET applying=1 WHERE id=1");
    for (const key of keys) {
      const state = await this.state(key.entity,key.id);
      if (!state) continue;
      const { data } = materialize(state);
      if (state.entity === "settings") {
        if (data) await this.db.execute("INSERT INTO sync_settings(id,payload_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json", [state.id, JSON.stringify(data)]);
        continue;
      }
      const spec = ENTITY_TABLES[state.entity];
      if (!data) { await this.db.execute(`DELETE FROM ${spec.table} WHERE id=?`, [state.id]); continue; }
      const values = { ...data }; delete values.tags;
      for (const key of Object.keys(values)) if (!spec.columns.includes(key)) throw new Error(`Invalid ${state.entity} field: ${key}`);
      // Keep orphan semantic states, but never violate local relational integrity.
      const parent = state.entity === "attachment" ? ["entry_id", "entries"] : state.entity === "message" ? ["conversation_id", "ai_conversations"] : null;
      if (parent) {
        const rows = await this.db.select(`SELECT id FROM ${parent[1]} WHERE id=?`, [values[parent[0]] as SqlParam]);
        if (!rows.length) { await this.db.execute(`DELETE FROM ${spec.table} WHERE id=?`, [state.id]); continue; }
      }
      for (const key of ["parent_entry_id", "proposed_entry_id"]) if (values[key]) {
        if (!(await this.db.select("SELECT id FROM entries WHERE id=?", [values[key] as string])).length) values[key] = null;
      }
      if (state.entity === "attachment" && values.sha256 != null && !/^[0-9a-f]{64}$/.test(String(values.sha256))) throw new Error("Invalid attachment hash");
      const columns = ["id", ...spec.columns];
      await this.db.execute(`INSERT INTO ${spec.table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${spec.columns.map((column) => `${column}=excluded.${column}`).join(",")}`,
        [state.id, ...spec.columns.map((column) => (values[column] ?? null) as SqlParam)]);
      if (state.entity === "attachment") await this.db.execute("UPDATE attachments SET file_missing=? WHERE id=?", [data.sha256 == null ? 1 : 0,state.id]);
      if (state.entity === "entry") {
        await this.db.execute("DELETE FROM entry_tags WHERE entry_id=?", [state.id]);
        if (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== "string")) throw new Error("Invalid entry tags");
        for (const [position, tag] of data.tags.entries()) await this.db.execute("INSERT INTO entry_tags(entry_id,tag,position) VALUES (?,?,?)", [state.id, tag as string, position]);
      }
    }
    await this.db.execute("UPDATE sync_control SET applying=0 WHERE id=1");
  }
  snapshotFrontier(path: string): Promise<Clock> {
    return this.run(async () => {
      const rows = await this.db.select<{frontier_json:string|null}>("SELECT frontier_json FROM sync_documents WHERE path=?",[path]);
      return rows[0]?.frontier_json ? JSON.parse(rows[0].frontier_json) : {};
    });
  }
  backendChanged(id: string): Promise<boolean> {
    return this.run(async () => { const previous = await this.meta<string|null>("lastBackend",null); return previous !== null && previous !== id; });
  }
  pendingSnapshots(backend: string): Promise<SnapshotCandidate[]> { return this.run(() => this.meta<SnapshotCandidate[]>(`pendingSnapshots:${backend}`,[])); }
  cacheSnapshot(document: SyncDocument, backend: string): Promise<void> {
    return this.run(() => this.db.transaction(async () => {
      const header = JSON.parse(document.content.slice(0,document.content.indexOf("\n")));
      await this.db.execute("INSERT INTO sync_documents(path,hash,frontier_json) VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash,frontier_json=excluded.frontier_json",[document.path,document.hash,JSON.stringify(header.frontier)]);
      const pending = await this.meta<SnapshotCandidate[]>(`pendingSnapshots:${backend}`,[]);
      if (!pending.some((item)=>item.path===document.path)) {
        pending.push({path:document.path,hash:document.hash,createdAt:header.createdAt});
        await this.putMeta(`pendingSnapshots:${backend}`,pending);
        // The recycle bin expires by identity, not by comparing this device's
        // delete timestamps against a snapshot's wall clock: the rows that
        // exist at this cut are exactly the rows the snapshot covers.
        const covered = await this.db.select<{ id: string }>("SELECT id FROM deleted_entries");
        await this.putMeta(`snapshotCoverage:${backend}`, { path: document.path, ids: covered.map((row) => row.id) });
      }
    }));
  }
  pendingGarbage(backend: string): Promise<string[]> { return this.run(() => this.meta<string[]>(`pendingGarbage:${backend}`, [])); }
  setPendingGarbage(paths: string[], backend: string): Promise<void> { return this.run(() => this.putMeta(`pendingGarbage:${backend}`, paths)); }

  markPublished(documents: Array<{ path: string; hash: string }>, now: Date, backend: string, snapshot: { path: string; createdAt: string }): Promise<void> {
    return this.run(() => this.db.transaction(async () => {
      for (const doc of documents) {
        await this.db.execute("INSERT INTO sync_documents(path,hash) VALUES (?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash", [doc.path, doc.hash]);
        await this.db.execute("DELETE FROM sync_batches WHERE path=?", [doc.path]);
      }
      const previous = await this.meta<{ path: string; createdAt: string } | null>("snapshot:" + backend, null);
      if (previous?.path !== snapshot.path) {
        // Only an acknowledged snapshot expires recovery, and only the rows its
        // own cut covered — a delete made while the upload was in flight is
        // never in that set, and no second clock can move the boundary.
        const coverage = await this.meta<{ path: string; ids: string[] } | null>(`snapshotCoverage:${backend}`, null);
        if (coverage?.path === snapshot.path) {
          for (let start = 0; start < coverage.ids.length; start += 500) {
            const chunk = coverage.ids.slice(start, start + 500);
            await this.db.execute(`DELETE FROM deleted_entries WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk);
          }
        }
        await this.putMeta(`snapshotCoverage:${backend}`, null);
      }
      await this.putMeta("snapshot:" + backend, snapshot);
      await this.putMeta("lastBackend", backend);
      await this.putMeta(`pendingSnapshots:${backend}`, []);
      await this.putMeta("datasetPublished", true); await this.putMeta("failures", 0); await this.putMeta("nextAttempt", 0); await this.putMeta("lastError", null); await this.putMeta("lastSuccess", now.toISOString());
    }));
  }
  failed(message: string, now = Date.now(), jitter = Math.random()): Promise<number> {
    return this.run(async () => {
      const failures = (await this.meta("failures", 0)) + 1;
      const next = now + Math.round(Math.min(15 * 60_000, 5000 * 2 ** Math.min(failures - 1, 12)) * (0.8 + jitter * 0.4));
      await this.putMeta("failures", failures); await this.putMeta("nextAttempt", next); await this.putMeta("lastError", message); return next;
    });
  }
  status(backend?: string): Promise<SyncLocalStatus> {
    return this.run(async () => {
      const count = async (table: string) => Number((await this.db.select<{ count: number }>(`SELECT count(*) AS count FROM ${table}`))[0].count);
      const snapshot = await this.meta<{ createdAt: string } | null>("snapshot:" + (backend ?? await this.meta("lastBackend", "")), null);
      const lastSnapshotAt = snapshot?.createdAt ?? null;
      return { lastSnapshotAt, nextSnapshotAt: nextSnapshotAt(lastSnapshotAt), pending: await count("sync_changes") + await count("sync_outbox") + await count("sync_batches"), conflicts: (await this.conflictsDirect()).length,
        failures: await this.meta("failures", 0), nextAttempt: await this.meta("nextAttempt", 0), lastSuccess: await this.meta<string | null>("lastSuccess", null), lastError: await this.meta<string | null>("lastError", null), missingAttachments: Number((await this.db.select<{count:number}>("SELECT count(*) AS count FROM attachments WHERE sha256 IS NULL OR file_missing=1"))[0].count) };
    });
  }
  private async reachable(state: EntityState): Promise<boolean> {
    const data = materialize(state).data;
    if (!data) return false;
    const parent = state.entity === "attachment" ? { entity: "entry" as const, id: data.entry_id }
      : state.entity === "message" ? { entity: "conversation" as const, id: data.conversation_id } : null;
    if (!parent) return true;
    const parentState = await this.state(parent.entity, String(parent.id));
    return !!parentState && materialize(parentState).data !== null;
  }
  private async conflictsDirect(): Promise<SyncConflict[]> {
    const rows = await this.db.select<{entity: EntityKind; id:string; field:string; versions_json:string}>("SELECT * FROM sync_conflicts ORDER BY entity,id,field");
    const result: SyncConflict[] = [];
    for (const row of rows) {
      const state = await this.state(row.entity,row.id);
      if (state && await this.reachable(state)) result.push({entity:row.entity,id:row.id,field:row.field,versions:JSON.parse(row.versions_json),clock:state.clock});
    }
    return result;
  }
  conflicts(): Promise<SyncConflict[]> { return this.run(() => this.conflictsDirect()); }
  resolve(entity: EntityKind, id: string, field: string, value: Json, expectedClock?: Clock): Promise<void> {
    return this.run(() => this.db.transaction(async () => {
      await this.flushDirect();
      const state = await this.state(entity, id);
      if (!state?.fields[field] || (expectedClock && !equal(expectedClock,state.clock))) throw new Error("SYNC_CONFLICT_CHANGED");
      const patch = { data: { [field]: value, $exists: field === "$exists" ? value : true }, base: { [field]: materialize(state).data?.[field] ?? null } };
      const op = await this.newOperation(state, entity, id, patch, new Date().toISOString());
      await this.saveState(applyOperation(state, op)); await this.projectChanged([{entity,id}]); notifyLocalChange(this.db);
    }));
  }
  setSettings(settings: Record<string, unknown>): Promise<void> {
    return this.run(() => this.db.transaction(async () => {
      const data = flattenSettings(settings);
      const rows = await this.db.select<{ payload_json: string }>("SELECT payload_json FROM sync_settings WHERE id=?", [SETTINGS_ID]);
      if (rows[0] && equal(JSON.parse(rows[0].payload_json), data)) return;
      await this.db.execute("INSERT INTO sync_settings(id,payload_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json", [SETTINGS_ID, stableJson(data)]);
      notifyLocalChange(this.db);
    }));
  }
  getSettings(): Promise<Record<string, unknown> | null> {
    return this.run(async () => {
      const rows = await this.db.select<{ payload_json: string }>("SELECT payload_json FROM sync_settings WHERE id=?", [SETTINGS_ID]);
      return rows[0] ? unflattenSettings(JSON.parse(rows[0].payload_json)) : null;
    });
  }
  attachmentImports(): Promise<Array<{ attachment_id: string; source_path: string }>> {
    return this.run(() => this.db.select("SELECT attachment_id,source_path FROM attachment_ingest_queue ORDER BY attachment_id"));
  }
  completeAttachmentImport(id: string, photo: AttachmentMetadata): Promise<void> {
    return this.run(() => this.db.transaction(async () => {
      if (!/^[a-f0-9]{64}$/.test(photo.sha256) || photo.bytes < 1 || photo.bytes > 100000 || Math.max(photo.width, photo.height) > 1280 || photo.mime !== "image/webp") throw new Error("Invalid compressed attachment");
      await this.db.execute("UPDATE attachments SET sha256=?,width=?,height=?,bytes=?,mime=?,file_missing=0 WHERE id=?", [photo.sha256,photo.width,photo.height,photo.bytes,photo.mime,id]);
      await this.db.execute("DELETE FROM attachment_ingest_queue WHERE attachment_id=?", [id]); notifyLocalChange(this.db);
    }));
  }
  attachmentMetadataNeeded(): Promise<string[]> {
    return this.run(async () => (await this.db.select<{sha256:string}>("SELECT DISTINCT sha256 FROM attachments WHERE sha256 IS NOT NULL AND (width IS NULL OR height IS NULL OR bytes IS NULL OR file_missing=1)")).map((row) => row.sha256));
  }
  completeAttachmentMetadata(requested: string[], photos: AttachmentMetadata[]): Promise<void> {
    return this.run(() => this.db.transaction(async () => {
      for (const photo of photos) {
        if (!requested.includes(photo.sha256) || !/^[a-f0-9]{64}$/.test(photo.sha256) || photo.bytes < 1 || photo.bytes > 100000 || photo.mime !== "image/webp" || photo.width < 1 || photo.height < 1 || Math.max(photo.width,photo.height)>1280) throw new Error("Invalid compressed attachment");
        await this.db.execute("UPDATE attachments SET width=?,height=?,bytes=?,mime=?,file_missing=0 WHERE sha256=?", [photo.width,photo.height,photo.bytes,photo.mime,photo.sha256]);
      }
      for (const hash of requested) if (!photos.some((photo) => photo.sha256===hash)) await this.db.execute("UPDATE attachments SET file_missing=1 WHERE sha256=? AND file_missing<>1", [hash]);
      if (requested.length) notifyLocalChange(this.db);
    }));
  }
  missingAttachmentDetails(): Promise<MissingAttachmentDetail[]> {
    return this.run(() => this.db.select<MissingAttachmentDetail>(
      `SELECT a.id AS attachmentId, a.entry_id AS entryId, e.title AS entryTitle, e.date AS entryDate,
              a.sha256 AS sha256, q.source_path AS sourcePath
         FROM attachments a
         JOIN entries e ON e.id = a.entry_id
         LEFT JOIN attachment_ingest_queue q ON q.attachment_id = a.id
        WHERE a.sha256 IS NULL OR a.file_missing = 1
        ORDER BY e.date DESC, e.title, a.sort, a.id`,
    ));
  }
  removeMissingAttachment(id: string): Promise<void> {
    return this.run(() => this.db.transaction(async () => {
      await this.db.execute("DELETE FROM attachments WHERE id = ? AND (sha256 IS NULL OR file_missing = 1)", [id]);
      notifyLocalChange(this.db);
    }));
  }
  clearMissingAttachments(): Promise<void> {
    return this.run(() => this.db.transaction(async () => {
      await this.db.execute("DELETE FROM attachments WHERE sha256 IS NULL OR file_missing = 1");
      notifyLocalChange(this.db);
    }));
  }
  /** Include unresolved versions as well as the visible version: conflicts must
   * never point at bytes that were discarded by transport/compaction. */
  attachmentHashes(): Promise<string[]> {
    return this.run(async () => {
      const hashes = new Set<string>();
      for await (const row of this.stateRows("WHERE entity='attachment'")) {
        const state = unpackState(JSON.parse(row.state_json));
        if (!(await this.reachable(state))) continue;
        for (const version of state.fields.sha256 ?? []) if (typeof version.value === "string" && /^[a-f0-9]{64}$/.test(version.value)) hashes.add(version.value);
      }
      return [...hashes].sort();
    });
  }
}
function flattenSettings(value: Record<string, unknown>, prefix = "", result: EntityData = {}): EntityData {
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid settings key");
    const path = prefix + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1");
    if (child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length) flattenSettings(child as Record<string, unknown>, path, result);
    else if (child !== undefined) result[path] = child as Json;
  }
  return result;
}
function unflattenSettings(data: EntityData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(data)) {
    const keys = path.split("/").slice(1).map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (!keys.length || keys.some((key) => ["__proto__", "constructor", "prototype"].includes(key))) throw new Error("Invalid settings path");
    let target = result;
    for (const key of keys.slice(0, -1)) {
      const child = target[key];
      if (!child || typeof child !== "object" || Array.isArray(child)) target[key] = {};
      target = target[key] as Record<string, unknown>;
    }
    target[keys.at(-1)!] = value;
  }
  return result;
}
