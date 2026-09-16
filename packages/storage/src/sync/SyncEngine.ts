import { SNAPSHOT_INTERVAL_MS } from "./snapshotPolicy";
import { createEntryId } from "@chronoeon/domain";
import { SyncStore, type SyncDocument } from "./SyncStore";
import { stableJson, UUID } from "./protocol";

export interface ObjectRef { path: string; hash: string }
export interface BatchRef extends ObjectRef { operations: number }
export interface SnapshotRef extends ObjectRef { generation: number; createdAt: string }
export interface RemoteIndex {
  version: 1;
  datasetId: string;
  snapshot: SnapshotRef | null;
  batches: BatchRef[];
  attachments: string[];
  devices: Record<string, { name: string; lastSeen: string; ackGeneration: number }>;
  retired: Array<ObjectRef & { retiredIn: number }>;
}
export interface RemoteFetch { head: string | null; index: RemoteIndex | null; documents: SyncDocument[] }
export interface Publication { expectedHead: string | null; index: RemoteIndex; documents: SyncDocument[]; deletePaths: string[] }
/** Git and WebDAV implement transport/CAS only. No business merge in a backend. */
export interface SyncBackend {
  /** Stable, non-secret connection identity; changing destinations needs a full logical checkpoint. */
  readonly id: string;
  fetch(known: Record<string, string>): Promise<RemoteFetch>;
  publish(publication: Publication): Promise<{ conflict: boolean }>;
}
export interface EngineResult { ok: true; sent: number; received: number; conflicts: number; snapshotCreated: boolean; attachmentCount: number }
export interface SyncRunOptions { rebuildSnapshot?: boolean }
const HASH = /^[a-f0-9]{64}$/;
const IMAGE_PATH = /^attachments\/([a-f0-9]{64})\.webp$/;
export function validDocumentPath(path: string): boolean {
  return /^(sync\/\d{4}\/\d{2}\/\d{2}-[a-zA-Z0-9-]+|snapshot\/snapshot-[a-zA-Z0-9-]+)\.jsonl\.zst$/.test(path);
}
export function validateIndex(value: unknown): asserts value is RemoteIndex {
  const index = value as RemoteIndex;
  if (!index || index.version !== 1 || !UUID.test(index.datasetId) || !Array.isArray(index.batches) || !Array.isArray(index.attachments)
    || !Array.isArray(index.retired) || !index.devices || typeof index.devices !== "object" || Array.isArray(index.devices)) throw new Error("SYNC_UNSUPPORTED_FORMAT");
  const seen = new Set<string>();
  const check = (ref: ObjectRef, retired = false) => {
    if (!ref || !(validDocumentPath(ref.path) || (retired && IMAGE_PATH.exec(ref.path)?.[1] === ref.hash)) || !HASH.test(ref.hash) || seen.has(ref.path)) throw new Error("SYNC_INVALID_INDEX");
    seen.add(ref.path);
  };
  if (index.snapshot) {
    check(index.snapshot);
    if (!index.snapshot.path.startsWith("snapshot/") || !Number.isSafeInteger(index.snapshot.generation) || index.snapshot.generation < 1 || !Number.isFinite(Date.parse(index.snapshot.createdAt))) throw new Error("SYNC_INVALID_INDEX");
  }
  for (const ref of index.batches) { check(ref); if (!ref.path.startsWith("sync/") || !Number.isSafeInteger(ref.operations) || ref.operations < 1) throw new Error("SYNC_INVALID_INDEX"); }
  for (const ref of index.retired) { check(ref, true); if (!Number.isSafeInteger(ref.retiredIn) || ref.retiredIn < 1) throw new Error("SYNC_INVALID_INDEX"); }
  if (index.attachments.some((hash) => !HASH.test(hash))) throw new Error("SYNC_INVALID_INDEX");
  for (const [id, device] of Object.entries(index.devices)) if (!UUID.test(id) || !device || typeof device.name !== "string"
    || !Number.isFinite(Date.parse(device.lastSeen)) || !Number.isSafeInteger(device.ackGeneration) || device.ackGeneration < 0 || device.ackGeneration > (index.snapshot?.generation ?? 0)) throw new Error("SYNC_INVALID_INDEX");
}
export async function contentHash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class SyncEngine {
  private running: Promise<EngineResult> | null = null;
  private rebuildRequested = false;
  private rebuilding = false;
  constructor(readonly store: SyncStore, private readonly backend: SyncBackend, private readonly options: {
    deviceName: string; now?: () => Date; onApplied?: () => Promise<void> | void;
    /** Native ingestion finishes before any journal batch can reference those bytes. */
    prepareAttachments?: () => Promise<void>;
    beforePublish?: () => Promise<void>;
    cancelled?: () => boolean;
  }) {}
  run(options: SyncRunOptions = {}): Promise<EngineResult> {
    if (options.rebuildSnapshot && !this.rebuilding) this.rebuildRequested = true;
    this.running ??= (async () => {
      let result: EngineResult;
      do {
        this.rebuilding = this.rebuildRequested;
        this.rebuildRequested = false;
        result = await this.perform(this.rebuilding);
      } while (this.rebuildRequested);
      return result;
    })().catch(async (error: unknown) => {
      if (!(error instanceof Error && error.message === "SYNC_CANCELLED")) await this.store.failed(error instanceof Error ? error.message : String(error)); throw error;
    }).finally(() => { this.running = null; this.rebuilding = false; this.rebuildRequested = false; });
    return this.running;
  }
  private async perform(rebuildSnapshot: boolean): Promise<EngineResult> {
    await this.options.prepareAttachments?.();
    if (!this.backend.id) throw new Error("SYNC_BACKEND_ID_REQUIRED");
    if (this.options.cancelled?.()) throw new Error("SYNC_CANCELLED");
    const deviceId = await this.store.deviceId();
    const backendChanged = await this.store.backendChanged(this.backend.id);
    let received = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const now = this.options.now?.() ?? new Date();
      await this.store.flush();
      const known = await this.store.knownDocuments();
      if (this.options.cancelled?.()) throw new Error("SYNC_CANCELLED");
      const remote = await this.backend.fetch(known);
      if (this.options.cancelled?.()) throw new Error("SYNC_CANCELLED");
      if (remote.index) validateIndex(remote.index);
      const datasetId = await this.store.bindDataset(remote.index?.datasetId);
      const expected = new Map([...(remote.index?.snapshot ? [remote.index.snapshot] : []), ...remote.index?.batches ?? []].map((ref) => [ref.path, ref.hash]));
      for (const doc of remote.documents) {
        if (expected.get(doc.path) !== doc.hash || await contentHash(doc.content) !== doc.hash) throw new Error("SYNC_CHECKSUM_FAILED");
      }
      for (const [path, hash] of expected) if (known[path] !== hash && !remote.documents.some((doc) => doc.path === path && doc.hash === hash)) throw new Error("SYNC_INCOMPLETE_REMOTE");
      const applied = await this.store.applyDocuments(remote.documents, datasetId);
      received += applied;
      if (applied) await this.options.onApplied?.();
      if (this.options.cancelled?.()) throw new Error("SYNC_CANCELLED");
      await this.options.beforePublish?.();
      const pending = await this.store.pack(now);
      const allBatches = await Promise.all(pending.map(async (batch) => ({ ...batch, hash: await contentHash(batch.content) })));
      const frontier = remote.index?.snapshot ? await this.store.snapshotFrontier(remote.index.snapshot.path) : {};
      const remoteRefs = new Map([...(remote.index?.snapshot ? [remote.index.snapshot] : []), ...remote.index?.batches ?? [], ...remote.index?.retired ?? []].map((ref)=>[ref.path,ref.hash]));
      const batches = allBatches.filter((batch) => {
        const remoteHash = remoteRefs.get(batch.path);
        if (remoteHash && remoteHash !== batch.hash) throw new Error("SYNC_IMMUTABLE_OBJECT_CHANGED");
        // A push may have succeeded before the client crashed. A later snapshot
        // can already cover that pending batch even after its path was retired.
        return !remoteHash && !batch.content.trim().split("\n").every((line) => {
          const op = JSON.parse(line) as {deviceId:string;sequence:number}; return (frontier[op.deviceId] ?? 0) >= op.sequence;
        });
      });
      const candidates = await this.store.pendingSnapshots(this.backend.id);
      const index: RemoteIndex = remote.index ? structuredClone(remote.index) : { version: 1, datasetId, snapshot: null, batches: [], attachments: [], devices: {}, retired: [] };
      let documents: SyncDocument[] = [...batches];
      const liveImages = await this.store.attachmentHashes();
      for (const batch of batches) {
        if (!index.batches.some((ref) => ref.path === batch.path)) index.batches.push({ path: batch.path, hash: batch.hash, operations: batch.content.trim().split("\n").length });
      }
      // Rebuild every seven days even without edits, so the Recycle Bin has
      // the same retention cycle. Manual rebuilds reset the cycle after publication.
      const snapshotCreated = rebuildSnapshot || !index.snapshot || backendChanged || now.getTime() - Date.parse(index.snapshot.createdAt) >= SNAPSHOT_INTERVAL_MS;
      if (snapshotCreated) {
        const generation = (index.snapshot?.generation ?? 0) + 1;
        const cut = this.options.now?.() ?? new Date();
        let content = await this.store.snapshot(datasetId, cut);
        const headerEnd = content.indexOf("\n");
        const header = JSON.parse(content.slice(0,headerEnd));
        // Reuse only unpublished bootstrap candidates. Once an index exists,
        // old snapshot paths may be retired and must never be reintroduced.
        const candidate = !rebuildSnapshot && remote.index === null ? candidates.at(-1) : undefined;
        if (candidate) {
          const reusable = JSON.stringify({...header,createdAt:candidate.createdAt}) + content.slice(headerEnd);
          if (await contentHash(reusable) === candidate.hash) content = reusable;
        }
        const hash = await contentHash(content);
        const snapshot = { path: candidate?.hash === hash ? candidate.path : `snapshot/snapshot-${now.toISOString().slice(0, 10)}-${createEntryId()}.jsonl.zst`, hash, content };
        await this.store.cacheSnapshot(snapshot, this.backend.id);
        if (index.snapshot) index.retired.push({ path: index.snapshot.path, hash: index.snapshot.hash, retiredIn: generation });
        // Unpublished local batches are already in this logical cut; no need to
        // upload them just to retire them immediately in the same Git commit.
        for (const batch of remote.index?.batches ?? []) index.retired.push({ path: batch.path, hash: batch.hash, retiredIn: generation });
        index.snapshot = { path: snapshot.path, hash: snapshot.hash, generation, createdAt: JSON.parse(content.slice(0,content.indexOf("\n"))).createdAt };
        index.batches = []; documents = [snapshot];
        // Only a fresh logical cut makes old image versions safe to retire.
        // Until all enrolled devices ack it, keep the bytes but do not make
        // new devices download deleted/unreachable photos.
        for (const hash of index.attachments) if (!liveImages.includes(hash)) index.retired.push({ path: `attachments/${hash}.webp`, hash, retiredIn: generation });
        index.attachments = liveImages;
      }
      index.attachments = [...new Set([...index.attachments, ...liveImages])].sort();
      // An offline edit can restore a reference while its bytes are retained.
      index.retired = index.retired.filter((ref) => !IMAGE_PATH.test(ref.path) || !index.attachments.includes(ref.hash));
      const previous = index.devices[deviceId];
      index.devices[deviceId] = { name: this.options.deviceName,
        lastSeen: previous?.lastSeen.slice(0, 10) === now.toISOString().slice(0, 10) ? previous.lastSeen : now.toISOString(),
        ackGeneration: index.snapshot?.generation ?? 0 };
      // Offline devices are never silently expired. Their ack keeps old objects
      // alive until they have imported a snapshot that makes those logs redundant.
      const acknowledged = Math.min(...Object.values(index.devices).map((device) => device.ackGeneration));
      const activePaths = new Set([...(index.snapshot ? [index.snapshot.path] : []), ...index.batches.map((ref) => ref.path), ...index.attachments.map((hash) => `attachments/${hash}.webp`)]);
      const deletePaths = [...new Set([...await this.store.pendingGarbage(this.backend.id), ...candidates.filter((candidate)=>!remoteRefs.has(candidate.path)).map((candidate)=>candidate.path), ...index.retired.filter((ref) => ref.retiredIn <= acknowledged).map((ref) => ref.path)])].filter((path) => !activePaths.has(path));
      index.retired = index.retired.filter((ref) => ref.retiredIn > acknowledged);
      validateIndex(index);
      if (documents.length || deletePaths.length || stableJson(index) !== stableJson(remote.index)) {
        await this.store.setPendingGarbage(deletePaths, this.backend.id);
        if (this.options.cancelled?.()) throw new Error("SYNC_CANCELLED");
        const result = await this.backend.publish({ expectedHead: remote.head, index, documents, deletePaths });
        if (result.conflict) continue; // Fetch, semantic merge and a fresh CAS; never force push.
      }
      await this.store.setPendingGarbage([], this.backend.id);
      await this.store.markPublished([...allBatches, ...documents], now, this.backend.id, index.snapshot!);
      return { ok: true, sent: batches.reduce((sum, batch) => sum + batch.content.trim().split("\n").length, 0), received,
        conflicts: (await this.store.status()).conflicts, snapshotCreated, attachmentCount: index.attachments.length };
    }
    throw new Error("SYNC_REMOTE_BUSY");
  }
}
