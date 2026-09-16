import { afterEach, describe, expect, it, vi } from "vitest";
import { createEntryId, type Entry } from "@chronoeon/domain";
import { AiConversationStore } from "../ai/aiConversationStore";
import { SyncStore } from "../sync/SyncStore";
import { SyncEngine, contentHash, type Publication, type RemoteIndex, type SyncBackend } from "../sync/SyncEngine";
import { openMemoryStore } from "./helpers";

afterEach(() => vi.useRealTimers());

class MemoryBackend implements SyncBackend {
  readonly id = createEntryId();
  index: RemoteIndex | null = null;
  head = 0;
  objects = new Map<string, { content: string; hash: string }>();
  fail = false;
  conflictOnce = false;
  commits = 0;
  async fetch(known: Record<string, string>) {
    const index = structuredClone(this.index);
    return { index, head: this.head ? String(this.head) : null,
      documents: [...(index?.snapshot ? [index.snapshot] : []), ...index?.batches ?? []].filter((ref) => known[ref.path] !== ref.hash).map((ref) => {
        const doc = this.objects.get(ref.path); if (!doc) throw new Error("missing object"); return { path: ref.path, ...doc };
      }) };
  }
  async publish(publication: Publication) {
    if (this.fail) throw new Error("offline");
    if (this.conflictOnce) { this.conflictOnce = false; return { conflict: true }; }
    if (publication.expectedHead !== (this.head ? String(this.head) : null)) return { conflict: true };
    for (const doc of publication.documents) { expect(await contentHash(doc.content)).toBe(doc.hash); this.objects.set(doc.path, { hash: doc.hash, content: doc.content }); }
    this.index = structuredClone(publication.index); this.head += 1; this.commits += 1;
    for (const path of publication.deletePaths) this.objects.delete(path);
    return { conflict: false };
  }
}
function entry(overrides: Partial<Entry> = {}): Entry {
  return { id: createEntryId(), kind: "task", title: "Local first", date: "2026-09-07", allDay: true, category: "general", color: "#77787b", status: "open", createdAt: "2026-09-07T08:00:00.000Z", ...overrides };
}
async function device(remote: MemoryBackend, name: string, now?: () => Date) {
  const { backend, store } = await openMemoryStore(); const sync = new SyncStore(backend);
  const engine = new SyncEngine(sync, remote, { deviceName: name, now });
  return { backend, store, sync, engine, chat: new AiConversationStore(backend) };
}

describe("logical operation-log sync", () => {
  it("bootstraps a new device from a logical snapshot and later JSONL batches without copying SQLite", async () => {
    const remote = new MemoryBackend(); const a = await device(remote, "A");
    const first = await a.store.create(entry({ kind: "idea", status: undefined, note: "第一行\n第二行\n\n日记" }));
    await a.sync.setSettings({ preferences: { locale: "zh", theme: "dark" } });
    await a.engine.run();
    expect(remote.index?.snapshot?.path).toMatch(/snapshot\/.+\.jsonl\.zst$/);
    expect([...remote.objects.keys()].some((path) => path.includes(".db"))).toBe(false);
    await a.store.update({ ...first, title: "Edited after snapshot" }); await a.engine.run();
    expect(remote.index?.batches).toHaveLength(1);
    const b = await device(remote, "B"); await b.engine.run();
    expect((await b.store.get(first.id))?.title).toBe("Edited after snapshot");
    expect((await b.store.get(first.id))?.note).toBe("第一行\n第二行\n\n日记");
    expect(await b.sync.getSettings()).toEqual({ preferences: { locale: "zh", theme: "dark" } });
    expect((await b.sync.status()).pending).toBe(0);
    const commits = remote.commits; await b.engine.run(); expect(remote.commits).toBe(commits);
  });
  it("clears recoverable deletes once a logical snapshot compacts the history", async () => {
    const remote = new MemoryBackend();
    let clock = new Date("2026-09-07T08:00:00.000Z");
    const a = await device(remote, "A", () => clock);
    const first = await a.store.create(entry());
    await a.engine.run();
    await a.store.delete(first.id);
    expect(await a.store.deletedEntries()).toHaveLength(1);
    clock = new Date(clock.getTime() + 15 * 24 * 60 * 60_000);
    await a.engine.run();
    expect(await a.store.deletedEntries()).toHaveLength(0);
  });
  it("merges different fields and independently appended AI messages from offline devices", async () => {
    const remote = new MemoryBackend(); const a = await device(remote, "A"); const b = await device(remote, "B");
    const first = await a.store.create(entry({ note: "base" }));
    const conversation = await a.chat.createConversation({ providerKind: "openai-compatible", title: "Planning" });
    await a.engine.run(); await b.engine.run();
    await a.store.update({ ...first, title: "A title" });
    await b.store.update({ ...(await b.store.get(first.id))!, note: "B diary\nsecond line" });
    const [one, two] = await Promise.all([a.chat.appendMessage(conversation.id, { role: "user", content: "A continuation" }), b.chat.appendMessage(conversation.id, { role: "user", content: "B continuation" })]);
    await a.engine.run(); await b.engine.run(); await a.engine.run();
    expect(await a.store.get(first.id)).toMatchObject({ title: "A title", note: "B diary\nsecond line" });
    expect((await a.chat.listMessages(conversation.id)).map((m) => m.id).sort()).toEqual([one.id, two.id].sort());
    expect((await a.sync.conflicts()).filter((c) => c.entity === "entry")).toHaveLength(0);
  });
  it("retains concurrent Todo status versions and resolves them with a new causal operation", async () => {
    const remote = new MemoryBackend(); const a = await device(remote, "A"); const b = await device(remote, "B");
    const first = await a.store.create(entry()); await a.engine.run(); await b.engine.run();
    await a.store.update({ ...first, status: "done" });
    await b.store.update({ ...(await b.store.get(first.id))!, status: "cancelled" });
    await a.engine.run(); await b.engine.run(); await a.engine.run();
    const conflict = (await a.sync.conflicts()).find((c) => c.id === first.id && c.field === "status")!;
    expect(conflict.versions.map((v) => v.value).sort()).toEqual(["cancelled", "done"]);
    await a.sync.resolve("entry", first.id, "status", "done"); await a.engine.run(); await b.engine.run();
    expect((await b.store.get(first.id))?.status).toBe("done");
    expect((await b.sync.conflicts()).filter((c) => c.field === "status")).toHaveLength(0);
  });
  it("merges non-overlapping diary lines and set-valued tags while preserving conflicting prose", async () => {
    const remote = new MemoryBackend(); const a = await device(remote, "A"); const b = await device(remote, "B");
    const first = await a.store.create(entry({ kind: "idea", status: undefined, note: "morning\nnoon\nevening", tags: ["base"] }));
    await a.engine.run(); await b.engine.run();
    await a.store.update({ ...first, note: "A morning\nnoon\nevening", tags: ["base", "A"] });
    await b.store.update({ ...(await b.store.get(first.id))!, note: "morning\nnoon\nB evening", tags: ["base", "B"] });
    await a.engine.run(); await b.engine.run(); await a.engine.run();
    expect((await a.store.get(first.id))?.note).toBe("A morning\nnoon\nB evening");
    expect((await a.store.get(first.id))?.tags?.sort()).toEqual(["A", "B", "base"]);
    await a.store.update({ ...(await a.store.get(first.id))!, note: "same field A" });
    await b.store.update({ ...(await b.store.get(first.id))!, note: "same field B" });
    await a.engine.run(); await b.engine.run();
    expect((await b.sync.conflicts()).find((c) => c.field === "note")?.versions).toHaveLength(2);
  });
  it("retains delete/edit conflicts and does not resurrect causally deleted objects on a new device", async () => {
    const remote = new MemoryBackend(); const a = await device(remote, "A"); const b = await device(remote, "B");
    const first = await a.store.create(entry()); await a.engine.run(); await b.engine.run();
    await a.store.delete(first.id); await b.store.update({ ...(await b.store.get(first.id))!, title: "offline edit" });
    await a.engine.run(); await b.engine.run();
    expect((await b.sync.conflicts()).find((c) => c.field === "$exists")).toBeTruthy();
    expect((await b.store.get(first.id))?.title).toBe("offline edit");
    await b.sync.resolve("entry", first.id, "$exists", false); await b.engine.run(); await a.engine.run();
    const c = await device(remote, "C"); await c.engine.run(); expect(await c.store.get(first.id)).toBeNull();
  });
  it("retries with the identical immutable batch after a crash/offline failure and a CAS race", async () => {
    const remote = new MemoryBackend(); const a = await device(remote, "A");
    await a.engine.run(); const first = await a.store.create(entry()); remote.fail = true;
    await expect(a.engine.run()).rejects.toThrow("offline");
    const pending = await a.sync.pack(); expect(pending).toHaveLength(1);
    expect((await a.sync.status()).nextAttempt).toBeGreaterThan(Date.now());
    remote.fail = false; remote.conflictOnce = true;
    const restarted = new SyncEngine(new SyncStore(a.backend), remote, { deviceName: "A" }); await restarted.run();
    expect(remote.index?.batches.map((ref) => ref.path)).toContain(pending[0].path);
    expect((await a.sync.status()).pending).toBe(0);
    const b = await device(remote, "B"); await b.engine.run(); expect(await b.store.get(first.id)).not.toBeNull();
  });
  it("compacts periodically, waits for every registered device ack, and still bootstraps a late device", async () => {
    let now = new Date("2026-09-07T12:00:00Z");
    const remote = new MemoryBackend(); const a = await device(remote, "A", () => now); const b = await device(remote, "B", () => now);
    const first = await a.store.create(entry()); await a.engine.run(); await b.engine.run();
    const oldSnapshot = remote.index!.snapshot!.path;
    now = new Date("2026-09-23T12:00:00Z"); await a.store.update({ ...first, title: "after compaction" }); await a.engine.run();
    expect(remote.index!.snapshot!.generation).toBe(2); expect(remote.objects.has(oldSnapshot)).toBe(true);
    expect(remote.index!.retired.some((ref) => ref.path === oldSnapshot)).toBe(true);
    const c = await device(remote, "C", () => now); await c.engine.run(); expect((await c.store.get(first.id))?.title).toBe("after compaction");
    await b.engine.run(); expect(remote.objects.has(oldSnapshot)).toBe(false);
    expect(remote.index!.retired).toHaveLength(0);
  });
  it("captures business writes in the same transaction and serializes entry/chat work", async () => {
    const remote = new MemoryBackend(); const a = await device(remote, "A");
    await expect(a.backend.transaction(async () => {
      await a.backend.execute("INSERT INTO entries(id,modality,title,date,all_day,created_at) VALUES (?,'task','rollback','2026-09-07',1,'2026-09-07')", [createEntryId()]);
      throw new Error("abort");
    })).rejects.toThrow("abort");
    expect((await a.sync.status()).pending).toBe(0);
    const conversation = await a.chat.createConversation({ providerKind: "openai-compatible" });
    await Promise.all(Array.from({ length: 12 }, (_, i) => i % 2 ? a.store.create(entry({ title: String(i) })) : a.chat.appendMessage(conversation.id, { role: "user", content: String(i) })));
    await a.engine.run(); const b = await device(remote, "B"); await b.engine.run();
    expect(await b.store.list()).toHaveLength(6); expect(await b.chat.listMessages(conversation.id)).toHaveLength(6);
  });
});


describe("semantic parent conflicts and attachment retention", () => {
  it("syncs missing attachment rows whose sha256 is null", async () => {
    const remote = new MemoryBackend(); const a = await device(remote, "A"); const b = await device(remote, "B");
    const first = await a.store.create(entry());
    const attachmentId = createEntryId();
    await a.backend.execute(
      "INSERT INTO attachments(id,entry_id,sha256,kind,width,height,bytes,mime,caption,sort,file_missing,created_at) VALUES (?,?,NULL,'image',NULL,NULL,NULL,NULL,NULL,0,1,?)",
      [attachmentId, first.id, "2026-09-07T08:00:00.000Z"],
    );
    await a.engine.run();
    await b.engine.run();
    expect((await b.store.get(first.id))?.images).toEqual([`attachments/missing-${attachmentId}.webp`]);
    expect((await b.sync.status()).missingAttachments).toBe(1);
    expect(await b.sync.missingAttachmentDetails()).toEqual([
      expect.objectContaining({ attachmentId, entryId: first.id, entryTitle: first.title, entryDate: first.date }),
    ]);
    await b.sync.removeMissingAttachment(attachmentId);
    expect((await b.sync.status()).missingAttachments).toBe(0);
    expect((await b.store.get(first.id))?.images).toBeUndefined();
  });

  it("retains photos when a parent delete races with an edit", async () => {
    const remote = new MemoryBackend(); const a = await device(remote,"A"); const b = await device(remote,"B");
    const hash = "a".repeat(64); const photo = `attachments/${hash}.webp`;
    const first = await a.store.create(entry({images:[photo]})); await a.engine.run(); await b.engine.run();
    await a.store.delete(first.id); await b.store.update({...(await b.store.get(first.id))!,title:"keep my diary"});
    await a.engine.run(); await b.engine.run(); await a.engine.run();
    expect((await a.store.get(first.id))?.images).toEqual([photo]);
    expect((await a.sync.conflicts()).some((conflict)=>conflict.field==="$exists")).toBe(true);
    await a.sync.resolve("entry",first.id,"$exists",true); await a.engine.run(); await b.engine.run();
    expect((await b.store.get(first.id))?.images).toEqual([photo]);
    expect(await b.sync.attachmentHashes()).toEqual([hash]);
  });
  it("keeps earlier AI messages when deletion races with a continuation", async () => {
    const remote = new MemoryBackend(); const a = await device(remote,"A"); const b = await device(remote,"B");
    const conversation = await a.chat.createConversation({providerKind:"openai-compatible",title:"History"});
    const first = await a.chat.appendMessage(conversation.id,{role:"user",content:"earlier message"});
    await a.engine.run(); await b.engine.run();
    await a.chat.deleteConversation(conversation.id);
    const later = await b.chat.appendMessage(conversation.id,{role:"assistant",content:"offline continuation"});
    await a.engine.run(); await b.engine.run(); await a.engine.run();
    expect((await a.chat.listMessages(conversation.id)).map((message)=>message.id).sort()).toEqual([first.id,later.id].sort());
    expect((await a.sync.conflicts()).some((conflict)=>conflict.entity==="conversation" && conflict.field==="$exists")).toBe(true);
  });
  it("retires removed photos only in a new snapshot and waits for every device ack", async () => {
    let now = new Date("2026-09-07T12:00:00Z");
    const remote = new MemoryBackend(); const a = await device(remote,"A",()=>now); const b = await device(remote,"B",()=>now);
    const hash="b".repeat(64); const first=await a.store.create(entry({images:[`attachments/${hash}.webp`]}));
    await a.engine.run(); await b.engine.run();
    await a.store.update({...first,images:[]}); await a.engine.run();
    expect(remote.index!.attachments).toContain(hash);
    now = new Date("2026-09-23T12:00:00Z"); await a.engine.run();
    expect(remote.index!.attachments).not.toContain(hash);
    expect(remote.index!.retired.some((ref)=>ref.path===`attachments/${hash}.webp`)).toBe(true);
    const c=await device(remote,"C",()=>now); await c.engine.run();
    expect((await c.store.get(first.id))?.images??[]).toEqual([]);
    await b.engine.run();expect(remote.index!.retired).toEqual([]);
  });
  it("syncs message edits/deletes individually and preserves same-message conflicts", async () => {
    const remote=new MemoryBackend();const a=await device(remote,"A");const b=await device(remote,"B");
    const conversation=await a.chat.createConversation({providerKind:"openai-compatible"});
    const one=await a.chat.appendMessage(conversation.id,{role:"user",content:"original"});
    const two=await a.chat.appendMessage(conversation.id,{role:"assistant",content:"another message"});
    await a.engine.run();await b.engine.run();
    await a.chat.updateMessage(one.id,"edit A");await b.chat.updateMessage(one.id,"edit B");
    await a.engine.run();await b.engine.run();
    const conflict=(await b.sync.conflicts()).find((conflict)=>conflict.entity==="message"&&conflict.field==="content")!;
    expect(conflict.versions.map((version)=>version.value).sort()).toEqual(["edit A","edit B"]);
    await b.sync.resolve("message",one.id,"content","edit B");await b.chat.deleteMessage(two.id);await b.engine.run();await a.engine.run();
    expect(await a.chat.listMessages(conversation.id)).toMatchObject([{id:one.id,content:"edit B"}]);
  });
  it("rejects corrupt remote documents before mutating local data", async () => {
    const remote=new MemoryBackend();const a=await device(remote,"A");const first=await a.store.create(entry());await a.engine.run();
    const ref=remote.index!.snapshot!;remote.objects.set(ref.path,{hash:ref.hash,content:"corrupt"});
    const b=await device(remote,"B");const local=await b.store.create(entry({title:"local survives"}));
    await expect(b.engine.run()).rejects.toThrow("SYNC_CHECKSUM_FAILED");
    expect(await b.store.get(first.id)).toBeNull();expect((await b.store.get(local.id))?.title).toBe("local survives");
  });
});


describe("local journal footprint",()=>{
  it("coalesces unsynchronized repeated edits without losing the final data",async()=>{
    const remote=new MemoryBackend();const a=await device(remote,"A");let item=await a.store.create(entry({tags:["one","two"]}));
    for(let index=0;index<40;index++)item=await a.store.update({...item,title:`Edit ${index}`,tags:["one",`tag-${index}`]});
    expect((await a.sync.status()).pending).toBe(1);
    await a.engine.run();const b=await device(remote,"B");await b.engine.run();
    expect(await b.store.get(item.id)).toMatchObject({title:"Edit 39",tags:["one","tag-39"]});
  });
});


describe("publication acknowledgements",()=>{
  it("does not reintroduce an unacknowledged batch after another device compacts it",async()=>{
    let now=new Date("2026-09-07T12:00:00Z");const remote=new MemoryBackend();const a=await device(remote,"A",()=>now);const b=await device(remote,"B",()=>now);
    const item=await a.store.create(entry());await a.engine.run();await b.engine.run();
    await a.store.update({...item,title:"server got it"});
    const acknowledge=a.sync.markPublished.bind(a.sync);let loseAck=true;
    a.sync.markPublished=async(...args)=>{if(loseAck){loseAck=false;throw new Error("lost local acknowledgement");}return acknowledge(...args);};
    await expect(a.engine.run()).rejects.toThrow("lost local acknowledgement");
    const old=(await a.sync.pack())[0].path;
    now=new Date("2026-09-23T12:00:00Z");await b.engine.run();
    expect(remote.index!.retired.some((ref)=>ref.path===old)).toBe(true);
    await a.engine.run();expect((await a.sync.status()).pending).toBe(0);
    expect(remote.index!.batches.some((ref)=>ref.path===old)).toBe(false);expect(remote.objects.has(old)).toBe(false);
    // A retry after the local ack is lost during GC sees an already-known snapshot.
    await a.engine.run();expect(remote.index!.batches.some((ref)=>ref.path===old)).toBe(false);
  });
  it("reuses an identical bootstrap snapshot on retry instead of growing history",async()=>{
    const remote=new MemoryBackend();const a=await device(remote,"A");await a.store.create(entry());remote.fail=true;
    await expect(a.engine.run()).rejects.toThrow("offline");const first=(await a.sync.pendingSnapshots(remote.id))[0];
    await expect(a.engine.run()).rejects.toThrow("offline");expect(await a.sync.pendingSnapshots(remote.id)).toEqual([first]);
    remote.fail=false;await a.engine.run();expect(remote.index!.snapshot!.path).toBe(first.path);
  });
  it("checkpoints all local state when switching back to a different destination",async()=>{
    const one=new MemoryBackend();const two=new MemoryBackend();const a=await device(one,"A");
    const item=await a.store.create(entry());await a.engine.run();
    const otherEngine=new SyncEngine(a.sync,two,{deviceName:"A"});await otherEngine.run();
    await a.store.update({...item,title:"changed on another backend"});await otherEngine.run();
    await a.engine.run();const b=await device(one,"B");await b.engine.run();
    expect((await b.store.get(item.id))?.title).toBe("changed on another backend");
  });
  it("does not upload a conversation deleted before the first journal capture",async()=>{
    const remote=new MemoryBackend();const a=await device(remote,"A");
    const conversation=await a.chat.createConversation({providerKind:"openai-compatible"});
    await a.chat.appendMessage(conversation.id,{role:"user",content:"never publish this discarded conversation"});await a.chat.deleteConversation(conversation.id);
    await a.engine.run();expect([...remote.objects.values()].some((doc)=>doc.content.includes("never publish"))).toBe(false);
  });
});


describe("rebuildable sync indexes",()=>{
  it("rebuilds child links without changing business rows or the outbox",async()=>{
    const remote=new MemoryBackend();const a=await device(remote,"A");
    const conversation=await a.chat.createConversation({providerKind:"openai-compatible"});
    await a.chat.appendMessage(conversation.id,{role:"user",content:"keep"});await a.sync.flush();
    const before=await a.sync.status();await a.backend.execute("DELETE FROM sync_links");
    await a.sync.rebuildDerivedIndexes();
    expect(await a.backend.select("SELECT * FROM sync_links WHERE parent_id=?",[conversation.id])).toHaveLength(1);
    expect((await a.sync.status()).pending).toBe(before.pending);
    expect(await a.chat.listMessages(conversation.id)).toHaveLength(1);
  });
});


describe("conflict-resolution concurrency",()=>{
  it("rejects a stale choice instead of overwriting a newer resolution",async()=>{
    const remote=new MemoryBackend();const a=await device(remote,"A");const b=await device(remote,"B");
    const item=await a.store.create(entry());await a.engine.run();await b.engine.run();
    await a.store.update({...item,status:"done"});await b.store.update({...item,status:"cancelled"});
    await a.engine.run();await b.engine.run();await a.engine.run();
    const stale=(await b.sync.conflicts()).find((conflict)=>conflict.field==="status")!;
    await a.sync.resolve("entry",item.id,"status","done");await a.engine.run();await b.engine.run();
    await expect(b.sync.resolve("entry",item.id,"status","cancelled",stale.clock)).rejects.toThrow("SYNC_CONFLICT_CHANGED");
    expect((await b.store.get(item.id))?.status).toBe("done");
  });
});


describe("checkpoint retry identities",()=>{
  it("does not reuse an already-published snapshot path after losing a destination-switch acknowledgement",async()=>{
    const one=new MemoryBackend();const two=new MemoryBackend();const a=await device(one,"A");const item=await a.store.create(entry());await a.engine.run();
    await new SyncEngine(a.sync,two,{deviceName:"A"}).run();await a.store.update({...item,title:"switch back"});
    const acknowledge=a.sync.markPublished.bind(a.sync);let lost=true;
    a.sync.markPublished=async(...args)=>{if(lost){lost=false;throw new Error("lost ack");}return acknowledge(...args);};
    await expect(a.engine.run()).rejects.toThrow("lost ack");const accepted=one.index!.snapshot!.path;
    await expect(a.engine.run()).resolves.toMatchObject({ok:true});
    expect(one.index!.snapshot!.path).not.toBe(accepted);expect(one.index!.batches).toEqual([]);
    const b=await device(one,"B");await b.engine.run();expect((await b.store.get(item.id))?.title).toBe("switch back");
  });
});


describe("seven-day snapshot and recycle-bin policy", () => {
  const week = 7 * 24 * 60 * 60_000;
  const day = 24 * 60 * 60_000;
  const origin = Date.parse("2026-09-09T08:00:00.000Z");
  function clock() { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(origin); }

  it("rebuilds at exactly seven days even if no business data changed", async () => {
    clock(); const remote = new MemoryBackend(), a = await device(remote, "A");
    await a.engine.run();
    expect(await a.sync.status(remote.id)).toMatchObject({ lastSnapshotAt: new Date(origin).toISOString(), nextSnapshotAt: new Date(origin + week).toISOString() });
    vi.setSystemTime(origin + week - 1); expect((await a.engine.run()).snapshotCreated).toBe(false);
    vi.setSystemTime(origin + week); expect((await a.engine.run()).snapshotCreated).toBe(true);
    expect(remote.index!.snapshot!.generation).toBe(2);
    expect((await a.sync.status()).nextSnapshotAt).toBe(new Date(origin + week * 2).toISOString());
  });

  it("manual rebuilds empty the current recycle bin and durably reset the deadline", async () => {
    clock(); const remote = new MemoryBackend(), a = await device(remote, "A");
    const first = await a.store.create(entry()); await a.engine.run();
    vi.setSystemTime(origin + day); await a.store.delete(first.id); await a.engine.run();
    expect(await a.store.deletedEntries()).toHaveLength(1);
    expect((await a.engine.run({ rebuildSnapshot: true })).snapshotCreated).toBe(true);
    expect(await a.store.deletedEntries()).toHaveLength(0);
    expect(remote.index!.snapshot!.generation).toBe(2);
    const reopened = new SyncStore(a.backend);
    expect(await reopened.status(remote.id)).toMatchObject({ lastSnapshotAt: new Date(origin + day).toISOString(), nextSnapshotAt: new Date(origin + day + week).toISOString() });
    expect((await reopened.status("different-destination")).nextSnapshotAt).toBeNull();
  });

  it("does not expire recovery or advance the deadline when publication fails", async () => {
    clock(); const remote = new MemoryBackend(), a = await device(remote, "A");
    const first = await a.store.create(entry()); await a.engine.run();
    vi.setSystemTime(origin + day); await a.store.delete(first.id); remote.fail = true;
    await expect(a.engine.run({ rebuildSnapshot: true })).rejects.toThrow("offline");
    expect(await a.store.deletedEntries()).toHaveLength(1);
    expect((await a.sync.status()).nextSnapshotAt).toBe(new Date(origin + week).toISOString());
    remote.fail = false; await a.engine.run({ rebuildSnapshot: true });
    expect(await a.store.deletedEntries()).toHaveLength(0);
  });

  it("finishes local expiry after a published snapshot's acknowledgement is lost", async () => {
    clock(); const remote = new MemoryBackend(), a = await device(remote, "A");
    const first = await a.store.create(entry()); await a.engine.run();
    vi.setSystemTime(origin + day); await a.store.delete(first.id);
    const publish = remote.publish.bind(remote); let loseAck = true;
    remote.publish = async (publication) => { const result = await publish(publication); if (loseAck) { loseAck = false; throw new Error("lost acknowledgement"); } return result; };
    await expect(a.engine.run({ rebuildSnapshot: true })).rejects.toThrow("lost acknowledgement");
    expect(await a.store.deletedEntries()).toHaveLength(1);
    const accepted = remote.index!.snapshot!.path;
    const reopened = new SyncEngine(new SyncStore(a.backend), remote, { deviceName: "A" });
    await reopened.run();
    expect(remote.index!.snapshot!.path).toBe(accepted); expect(await a.store.deletedEntries()).toHaveLength(0);
    expect((await a.sync.status()).nextSnapshotAt).toBe(new Date(origin + day + week).toISOString());
  });

  it("keeps a newer local delete when adopting an older snapshot", async () => {
    clock(); const remote = new MemoryBackend(), a = await device(remote, "A"), b = await device(remote, "B");
    const first = await a.store.create(entry()); await a.engine.run(); await b.engine.run();
    vi.setSystemTime(origin + 1000); await a.engine.run({ rebuildSnapshot: true });
    vi.setSystemTime(origin + day); await b.store.delete(first.id); await b.engine.run();
    expect(await b.store.deletedEntries()).toHaveLength(1);
    expect((await b.sync.status()).nextSnapshotAt).toBe(new Date(origin + 1000 + week).toISOString());
  });

  it("does not clear deletions made while the snapshot upload was in flight", async () => {
    clock(); const remote = new MemoryBackend(), a = await device(remote, "A");
    const before = await a.store.create(entry()), during = await a.store.create(entry()); await a.engine.run();
    vi.setSystemTime(origin + day); await a.store.delete(before.id);
    const publish = remote.publish.bind(remote);
    remote.publish = async (publication) => { vi.setSystemTime(origin + day + 1000); await a.store.delete(during.id); return publish(publication); };
    await a.engine.run({ rebuildSnapshot: true });
    expect((await a.store.deletedEntries()).map((item) => item.id)).toEqual([during.id]);
  });

  it("preserves offline-device acknowledgements and deletion tombstones during a manual rebuild", async () => {
    clock(); const remote = new MemoryBackend(), a = await device(remote, "A"), b = await device(remote, "B");
    const first = await a.store.create(entry()); await a.engine.run(); await b.engine.run();
    const oldPath = remote.index!.snapshot!.path;
    vi.setSystemTime(origin + day); await a.store.delete(first.id); remote.conflictOnce = true;
    await a.engine.run({ rebuildSnapshot: true });
    expect(remote.objects.has(oldPath)).toBe(true);
    const late = await device(remote, "Late"); await late.engine.run(); expect(await late.store.get(first.id)).toBeNull();
    await b.engine.run(); expect(await b.store.get(first.id)).toBeNull(); expect(remote.objects.has(oldPath)).toBe(false);
  });

  it("coalesces manual rebuilds requested during an active normal sync", async () => {
    clock(); const remote = new MemoryBackend(), a = await device(remote, "A"); await a.engine.run();
    vi.setSystemTime(origin + day);
    const fetch = remote.fetch.bind(remote); let release!: () => void, first = true;
    remote.fetch = async (known) => { if (first) { first = false; await new Promise<void>((resolve) => { release = resolve; }); } return fetch(known); };
    const normal = a.engine.run(); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const manual = a.engine.run({ rebuildSnapshot: true }); expect(a.engine.run({ rebuildSnapshot: true })).toBe(manual);
    release(); await normal; expect((await manual).snapshotCreated).toBe(true);
    expect(remote.index!.snapshot!.generation).toBe(2);
  });
});
