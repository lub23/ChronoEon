import { describe, expect, it } from "vitest";
import type { Entry } from "@chronoeon/domain";
import { StorageError, isStorageError } from "../errors";
import { ensureMigrated, SCHEMA_VERSION } from "../migrations";
import { MemorySqliteBackend } from "../persistence/MemorySqliteBackend";
import { SqliteEntryStore } from "../SqliteEntryStore";
import { openMemoryStore } from "./helpers";

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000001",
    kind: "task",
    title: "Test task",
    date: "2026-07-25",
    allDay: true,
    category: "work",
    calendar: "default",
    color: "#77787b",
    createdAt: "2026-07-25T08:00:00.000Z",
    ...overrides,
  };
}

describe("storage unit", () => {
  it("creates the schema and bumps user_version to the latest", async () => {
    const { backend, store } = await openMemoryStore();
    const tables = await backend.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    const names = tables.map((row) => row.name).sort();
    expect(names).toEqual([
      "ai_conversations", "ai_messages", "attachments", "entries",
      "entry_tags", "schema_meta", "timer_session", "attachment_ingest_queue",
      "sync_batches", "sync_changes", "sync_conflicts", "sync_control", "sync_documents",
      "sync_entities", "sync_links", "sync_meta", "sync_outbox", "sync_settings",
      "deleted_entries",
    ].sort());
    const version = await backend.select<{ user_version: number }>("PRAGMA user_version");
    expect(version[0].user_version).toBe(SCHEMA_VERSION);
    expect(await store.isEmpty()).toBe(true);
  });

  it("creates and reads an entry with tags round-tripped", async () => {
    const { store } = await openMemoryStore();
    const created = await store.create(entry({
      kind: "event", title: "Meeting", date: "2026-07-25",
      start: "09:00", end: "09:30", tags: ["focus", "work"], priority: "high",
    }));
    expect(created.priority).toBe("high");
    expect(created.tags).toEqual(["focus", "work"]);
    const read = await store.get(created.id);
    expect(read).toMatchObject({
      kind: "event", title: "Meeting", date: "2026-07-25",
      start: "09:00", end: "09:30", priority: "high",
    });
    expect(read?.tags).toEqual(["focus", "work"]);
  });

  it("keeps recent deletes recoverable until the recycle bin is cleared", async () => {
    const { store } = await openMemoryStore();
    const hash = "a".repeat(64);
    const created = await store.create(entry({
      title: "Recover me",
      tags: ["keep"],
      images: [`attachments/${hash}.webp`],
    }));
    await store.delete(created.id);
    expect(await store.get(created.id)).toBeNull();

    const deleted = await store.deletedEntries();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ id: created.id, entry: { title: "Recover me", tags: ["keep"] } });

    const restored = await store.restoreDeleted(created.id);
    expect(restored).toMatchObject({ id: created.id, title: "Recover me", tags: ["keep"], images: [`attachments/${hash}.webp`] });
    expect(await store.deletedEntries()).toHaveLength(0);

    await store.delete(created.id);
    await store.clearDeletedEntries();
    expect(await store.deletedEntries()).toHaveLength(0);
    await expect(store.restoreDeleted(created.id)).rejects.toMatchObject({ code: "EntryNotFound" });
  });

  it("rejects fine-grained priority literals at the SQL boundary", async () => {
    const { backend, store } = await openMemoryStore();
    const base = entry({ id: "00000000-0000-4000-8000-000000000002" });
    await expect(store.create(base)).resolves.toBeTruthy();
    // A caller that bypasses narrowEntryPriority and writes a legacy literal is refused by the CHECK.
    await expect(backend.execute("UPDATE entries SET priority = 'highest' WHERE id = ?", [base.id]))
      .rejects.toThrow();
  });

  it("does not persist or return priority metadata for ideas", async () => {
    const { backend, store } = await openMemoryStore();
    const created = await store.create(entry({
      id: "00000000-0000-4000-8000-000000000003",
      kind: "idea",
      title: "Idea",
      priority: "high",
      urgency: "low",
    }));
    expect(created.priority).toBeUndefined();
    expect(created.urgency).toBeUndefined();
    const raw = await backend.select<{ priority: string | null; urgency: string | null }>(
      "SELECT priority, urgency FROM entries WHERE id = ?", [created.id]
    );
    expect(raw[0]).toEqual({ priority: null, urgency: null });
    expect(await store.get(created.id)).toMatchObject({ kind: "idea", priority: undefined, urgency: undefined });
  });

  it("round-trips recurrence exceptions and moves as JSON", async () => {
    const { store } = await openMemoryStore();
    const created = await store.create(entry({
      kind: "task",
      title: "Recurring",
      recurrence: "weekly",
      recurringDays: [1, 3],
      recurringEnd: "2026-12-31",
      recurrenceExceptions: { "2026-07-27": { status: "done", doneAt: "2026-07-27T10:00:00.000Z" } },
      recurrenceMoves: { "2026-07-27": { begin: "2026-07-28 09:00" } },
    }));
    const read = await store.get(created.id);
    expect(read?.recurrence).toBe("weekly");
    expect(read?.recurringDays).toEqual([1, 3]);
    expect(read?.recurrenceExceptions).toEqual({ "2026-07-27": { status: "done", doneAt: "2026-07-27T10:00:00.000Z" } });
    expect(read?.recurrenceMoves).toEqual({ "2026-07-27": { begin: "2026-07-28 09:00" } });
  });

  it("raises RevisionMismatch on a stale expectedUpdatedAt and leaves the row unchanged", async () => {
    const { store } = await openMemoryStore();
    const created = await store.create(entry({ title: "Original" }));
    await store.update({ ...created, title: "Changed once" });
    await expect(store.update(
      { ...created, title: "Changed twice" },
      { expectedUpdatedAt: "v1:stale" },
    )).rejects.toSatisfy((error: unknown) => isStorageError(error) && error.code === "RevisionMismatch");
    expect((await store.get(created.id))?.title).toBe("Changed once");
  });

  it("raises EntryNotFound for update/delete of a missing id", async () => {
    const { store } = await openMemoryStore();
    const ghost = entry({ id: "00000000-0000-4000-8000-000000000099", title: "Ghost" });
    await expect(store.update(ghost)).rejects.toSatisfy((error: unknown) => isStorageError(error) && error.code === "EntryNotFound");
    await expect(store.delete(ghost.id)).rejects.toSatisfy((error: unknown) => isStorageError(error) && error.code === "EntryNotFound");
  });

  it("emits created/updated/deleted events to subscribers", async () => {
    const { store } = await openMemoryStore();
    const events: string[] = [];
    store.subscribe((event) => events.push(event.type));
    const created = await store.create(entry({ title: "Watched" }));
    await store.update({ ...created, title: "Watched again" });
    await store.delete(created.id);
    expect(events).toEqual(["created", "updated", "deleted"]);
  });

  it("filters by date range, kind, category and calendar", async () => {
    const { store } = await openMemoryStore();
    await store.create(entry({ id: "00000000-0000-4000-8000-000000000011", kind: "event", title: "July", date: "2026-07-10" }));
    await store.create(entry({ id: "00000000-0000-4000-8000-000000000012", kind: "bill", title: "August", date: "2026-08-10", category: "food", amount: -12 }));
    const july = await store.list({ from: "2026-07-01", to: "2026-07-31" });
    expect(july.map((value) => value.title)).toEqual(["July"]);
    const bills = await store.list({ kinds: ["bill"] });
    expect(bills.map((value) => value.title)).toEqual(["August"]);
    const food = await store.list({ categories: ["food"] });
    expect(food.map((value) => value.title)).toEqual(["August"]);
  });

  it("searches by substring over titles, notes, locations and tags", async () => {
    const { store } = await openMemoryStore();
    await store.create(entry({ id: "00000000-0000-4000-8000-000000000021", title: "Quarterly budget review", note: "numbers" }));
    await store.create(entry({ id: "00000000-0000-4000-8000-000000000022", title: "日程安排", titleZh: "今日日程", tags: ["meeting"] }));
    await store.create(entry({ id: "00000000-0000-4000-8000-000000000023", title: "Plain" }));
    expect((await store.list({ search: "budget" })).map((value) => value.title)).toEqual(["Quarterly budget review"]);
    expect((await store.list({ search: "今日" })).map((value) => value.title)).toEqual(["日程安排"]);
    expect((await store.list({ search: "meeting" })).map((value) => value.title)).toEqual(["日程安排"]);
    // Substring mid-token works through the LIKE fallback (old index semantics).
    expect((await store.list({ search: "udget" })).map((value) => value.title)).toEqual(["Quarterly budget review"]);
    expect(await store.list({ search: "absent" })).toEqual([]);
  });

  it("refuses a database whose user_version is newer than the running code", async () => {
    const backend = await MemorySqliteBackend.open([]);
    await backend.execute("PRAGMA user_version = 99");
    await expect(ensureMigrated(backend)).rejects.toSatisfy(
      (error: unknown) => error instanceof StorageError && error.code === "SchemaVersionUnsupported"
    );
  });

  it("syncs attachments rows from entry.images on create and update", async () => {
    const { backend, store } = await openMemoryStore();
    const created = await store.create(entry({
      id: "00000000-0000-4000-8000-000000000031",
      kind: "event",
      images: ["attachments/cd3518067eb62f5133a2a9f9632501e39aad757036c447adb63642be333dc9f4.webp", "attachments/83c9603a7f7291c8a0198bab0cc348dcb530da3df9a1fb54469d445fabf7fe64.webp"],
    }));
    expect(created.images).toEqual(["attachments/cd3518067eb62f5133a2a9f9632501e39aad757036c447adb63642be333dc9f4.webp", "attachments/83c9603a7f7291c8a0198bab0cc348dcb530da3df9a1fb54469d445fabf7fe64.webp"]);
    await store.update({ ...created, title: "With one photo", images: ["attachments/cd3518067eb62f5133a2a9f9632501e39aad757036c447adb63642be333dc9f4.webp"] });
    const rows = await backend.select<{ entry_id: string; sha256: string; kind: string }>(
      "SELECT entry_id, sha256, kind FROM attachments WHERE entry_id = ? ORDER BY sort", [created.id],
    );
    expect(rows).toEqual([{ entry_id: created.id, sha256: "cd3518067eb62f5133a2a9f9632501e39aad757036c447adb63642be333dc9f4", kind: "image" }]);
  });

  it("preserves attachment metadata for paths that survive an entry edit", async () => {
    const { backend, store } = await openMemoryStore();
    const created = await store.create(entry({
      id: "00000000-0000-4000-8000-000000000032",
      kind: "event",
      images: ["attachments/a4e67d6e3d78908cd2a02c511c4d3dcece6e753d3e4321ea41d7ff249ddcec74.webp"],
    }));
    // Simulate seed-quality metadata on the row.
    await backend.execute("UPDATE attachments SET bytes = 1234, file_missing = 0, caption = 'me' WHERE entry_id = ?", [created.id]);

    await store.update({
      ...created,
      title: "Edited",
      images: ["attachments/a4e67d6e3d78908cd2a02c511c4d3dcece6e753d3e4321ea41d7ff249ddcec74.webp", "attachments/ddad10c45eccdccf7fdaf9a6eb8598df34a6771e3702b1969eb58f0d229c1f31.webp"],
    });
    const rows = await backend.select<{ sha256: string; bytes: number | null; caption: string | null; file_missing: number }>(
      "SELECT sha256, bytes, caption, file_missing FROM attachments WHERE entry_id = ? ORDER BY sort", [created.id],
    );
    expect(rows).toEqual([
      { sha256: "a4e67d6e3d78908cd2a02c511c4d3dcece6e753d3e4321ea41d7ff249ddcec74", bytes: 1234, caption: "me", file_missing: 0 },
      { sha256: "ddad10c45eccdccf7fdaf9a6eb8598df34a6771e3702b1969eb58f0d229c1f31", bytes: null, caption: null, file_missing: 0 },
    ]);

    // Removing a path deletes exactly that row.
    await store.update({ ...created, title: "Trimmed", images: ["attachments/a4e67d6e3d78908cd2a02c511c4d3dcece6e753d3e4321ea41d7ff249ddcec74.webp"] });
    const trimmed = await backend.select<{ sha256: string }>("SELECT sha256 FROM attachments WHERE entry_id = ?", [created.id]);
    expect(trimmed).toEqual([{ sha256: "a4e67d6e3d78908cd2a02c511c4d3dcece6e753d3e4321ea41d7ff249ddcec74" }]);
  });

  it("preserves tag order across a round trip", async () => {
    const { store } = await openMemoryStore();
    const created = await store.create(entry({
      id: "00000000-0000-4000-8000-000000000051",
      tags: ["zeta", "alpha", "mid"],
    }));
    expect(created.tags).toEqual(["zeta", "alpha", "mid"]);
    expect((await store.get(created.id))?.tags).toEqual(["zeta", "alpha", "mid"]);
  });

  it("filters by calendar id treating a missing calendar as default", async () => {
    const { store } = await openMemoryStore();
    await store.create(entry({ id: "00000000-0000-4000-8000-000000000052", calendar: undefined, title: "Default calendar" }));
    await store.create(entry({ id: "00000000-0000-4000-8000-000000000053", calendar: "work", title: "Work calendar" }));
    const defaults = await store.list({ calendarIds: ["default"] });
    expect(defaults.map((value) => value.title)).toEqual(["Default calendar"]);
    const work = await store.list({ calendarIds: ["work"] });
    expect(work.map((value) => value.title)).toEqual(["Work calendar"]);
  });

  it("serializes concurrent reads on the shared test connection", async () => {
    const { store } = await openMemoryStore();
    await store.create(entry({ id: "00000000-0000-4000-8000-000000000061", title: "Race" }));
    // Two parallel list() calls (StrictMode boot) must both resolve cleanly.
    const [left, right] = await Promise.all([store.list(), store.list({ search: "Race" })]);
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
  });

  it("cascades tags and attachments when an entry is deleted", async () => {
    const { backend, store } = await openMemoryStore();
    const created = await store.create(entry({
      id: "00000000-0000-4000-8000-000000000041",
      tags: ["x"], images: ["attachments/cd3518067eb62f5133a2a9f9632501e39aad757036c447adb63642be333dc9f4.webp"],
    }));
    await store.delete(created.id);
    const tags = await backend.select("SELECT * FROM entry_tags WHERE entry_id = ?", [created.id]);
    const attachments = await backend.select("SELECT * FROM attachments WHERE entry_id = ?", [created.id]);
    expect(tags).toEqual([]);
    expect(attachments).toEqual([]);
  });
});
