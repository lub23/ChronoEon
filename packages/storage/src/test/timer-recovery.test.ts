import { describe, expect, it, vi } from "vitest";
import { createTimerSession, recoverTimerSession, draftToEntry } from "@chronoeon/domain";
import { TimerStore } from "../timer/TimerStore";
import { openMemoryStore } from "./helpers";

/**
 * Crash-recovery contract for the live stopwatch. The `timer_session` row is
 * the single source of truth; the app-layer recovery logic
 * (`recoverTimerSession`) runs against the loaded payload unchanged, so the
 * "app-off time is never billed" invariant holds across a crash.
 */
describe("timer persistence", () => {
  it("round-trips a running session", async () => {
    const { backend } = await openMemoryStore();
    const timers = new TimerStore(backend);
    const session = createTimerSession({ title: "Focus", calendarId: "default" }, 1_700_000_000_000);
    await timers.save(session);

    const loaded = await timers.load();
    expect(loaded).toEqual(session);
    expect(loaded?.segments).toEqual([{ start: 1_700_000_000_000 }]);
    expect(await timers.updatedAt()).toBeTruthy();
  });

  it("recovers a crashed recording by capping the open segment at the last heartbeat", async () => {
    const { backend } = await openMemoryStore();
    const timers = new TimerStore(backend);
    const started = 1_700_000_000_000;
    const lastTick = started + 60_000;
    await timers.save({ ...createTimerSession({ title: "Crashed", calendarId: "default" }, started), lastTick });

    const loaded = await timers.load();
    const recovery = recoverTimerSession(loaded!, started + 3_600_000); // app reopened an hour later
    expect(recovery.recovered).toBe(true);
    expect(recovery.session.segments[0].end).toBe(lastTick); // the hour offline is never billed
  });

  it("clears the row when the session is cancelled", async () => {
    const { backend } = await openMemoryStore();
    const timers = new TimerStore(backend);
    await timers.save(createTimerSession({ title: "Short", calendarId: "default" }, Date.now()));
    await timers.save(null);
    expect(await timers.load()).toBeNull();
    expect(await timers.updatedAt()).toBeNull();
  });

  it("treats a corrupt payload as no session", async () => {
    const { backend } = await openMemoryStore();
    const timers = new TimerStore(backend);
    await timers.save(createTimerSession({ title: "Good", calendarId: "default" }, Date.now()));
    await backend.execute("UPDATE timer_session SET payload_json = 'not-json' WHERE id = 'active'");
    expect(await timers.load()).toBeNull();
    await backend.execute("UPDATE timer_session SET payload_json = '{\"no\":\"segments\"}' WHERE id = 'active'");
    expect(await timers.load()).toBeNull();
  });

  it("overwrites on repeated saves (single row)", async () => {
    const { backend } = await openMemoryStore();
    const timers = new TimerStore(backend);
    await timers.save(createTimerSession({ title: "First", calendarId: "default" }, 1_000));
    await timers.save(createTimerSession({ title: "Second", calendarId: "default" }, 2_000));
    const rows = await backend.select<{ id: string }>("SELECT id FROM timer_session");
    expect(rows).toHaveLength(1);
    expect((await timers.load())?.title).toBe("Second");
  });
});


describe("atomic recording hand-off", () => {
  const entry = () => draftToEntry({ kind: "event", title: "Reading", date: "2026-09-09", category: "学习", location: "Library", note: "chapter 3\n⏱ 5:00" });
  it("creates the entry and clears the live timer in one transaction", async () => {
    const { backend, store } = await openMemoryStore(); const timers = new TimerStore(backend);
    const session = createTimerSession({ title: "Reading", calendarId: "default" }, Date.now());
    await timers.save(session);
    const created = await store.createFromTimer(entry(), session.id);
    expect(await timers.load()).toBeNull();
    expect(await store.get(created.id)).toMatchObject({ title: "Reading", location: "Library", note: "chapter 3\n⏱ 5:00" });
  });
  it("rolls back the entry when the timer cannot be cleared", async () => {
    const { backend, store } = await openMemoryStore(); const timers = new TimerStore(backend);
    const session = createTimerSession({ title: "Reading", calendarId: "default" }, Date.now()); await timers.save(session);
    const execute = backend.execute.bind(backend);
    const spy = vi.spyOn(backend, "execute").mockImplementation((sql, params) => sql.startsWith("DELETE FROM timer_session") ? Promise.reject(new Error("disk full")) : execute(sql, params));
    await expect(store.createFromTimer(entry(), session.id)).rejects.toThrow("disk full");
    spy.mockRestore();
    expect(await store.list()).toHaveLength(0); expect(await timers.load()).toEqual(session);
    await store.createFromTimer(entry(), session.id);
    expect(await store.list()).toHaveLength(1); expect(await timers.load()).toBeNull();
  });
  it("does not consume a different timer session", async () => {
    const { backend, store } = await openMemoryStore(); const timers = new TimerStore(backend);
    const session = createTimerSession({ title: "New", calendarId: "default" }, Date.now()); await timers.save(session);
    await expect(store.createFromTimer(entry(), "older-session")).rejects.toThrow("active timer changed");
    expect(await store.list()).toHaveLength(0); expect(await timers.load()).toEqual(session);
  });
});
