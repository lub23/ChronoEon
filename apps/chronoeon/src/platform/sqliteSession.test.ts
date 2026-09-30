// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createEntryId, createDefaultSettings, draftToItem } from "@chronoeon/domain";
import { MemorySqliteBackend } from "@chronoeon/storage/test";
import { createSqliteStoreSession } from "./sqliteSession";

describe("sqlite boot", () => {
  it("resolves null without a backend outside Tauri (browser demo path)", async () => {
    const session = await createSqliteStoreSession();
    expect(session).toBeNull();
  });

  it("boots with an injected backend and wires the EntryStore", async () => {
    const backend = await MemorySqliteBackend.open([]);
    const session = await createSqliteStoreSession({ backend });
    expect(session).not.toBeNull();
    const created = await session!.store.create({
      id: createEntryId(),
      kind: "task",
      title: "SQLite wired",
      date: "2026-08-10",
      allDay: true,
      category: "work",
      calendar: "default",
      color: "#77787b",
      createdAt: new Date().toISOString(),
    });
    expect((await session!.store.get(created.id))?.title).toBe("SQLite wired");
    const item = await session!.items.save(draftToItem({ name: "Gift", calendarId: "default", category: "other", acquisition: "gift", acquiredOn: "2026-08-10", acquiredAt: "09:00", cost: 0, currency: "CNY" }), createDefaultSettings("en"));
    expect(await session!.items.list()).toEqual([item]);
    const snapshot = await session!.sync.snapshot(createEntryId());
    expect(snapshot).toContain('"entity":"asset"');
    await session!.dispose();
  });

  it("pins the narrowed EntryPriority contract: normal is undefined", async () => {
    const backend = await MemorySqliteBackend.open([]);
    const session = await createSqliteStoreSession({ backend });
    const created = await session!.store.create({
      id: createEntryId(),
      kind: "task",
      title: "Priority pin",
      date: "2026-08-10",
      allDay: true,
      category: "work",
      calendar: "default",
      color: "#77787b",
      createdAt: new Date().toISOString(),
    });
    expect(created.priority).toBeUndefined();
    expect((await session!.store.get(created.id))?.priority).toBeUndefined();
    await session!.dispose();
  });
});
