import { describe, expect, it } from "vitest";
import { SCHEMA_SQL, SCHEMA_V2_SQL, SCHEMA_V3_SQL, SCHEMA_V4_SQL, SCHEMA_V5_SQL, SCHEMA_V6_SQL, SCHEMA_V8_SQL, SCHEMA_V9_SQL, SCHEMA_V10_SQL } from "../schema/schemaSql";
import { MemorySqliteBackend } from "../persistence/MemorySqliteBackend";
import { AiConversationStore } from "../ai/aiConversationStore";
import { ensureMigrated, MIGRATION_STEPS, SCHEMA_VERSION, verifyIntegrity } from "../migrations";

describe("migrations", () => {
  it("applies all steps and lands on the latest schema version", async () => {
    const backend = await MemorySqliteBackend.open([]);
    await ensureMigrated(backend);
    const version = await backend.select<{ user_version: number }>("PRAGMA user_version");
    expect(version[0].user_version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(10);

    const tables = await backend.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('timer_session', 'timer_segments')"
    );
    expect(tables.map((row) => row.name).sort()).toEqual(["timer_session"]);

    const attachmentColumns = await backend.select<{ name: string }>("PRAGMA table_info(attachments)");
    expect(attachmentColumns.map((row) => row.name)).toContain("sha256");
    expect(attachmentColumns.map((row) => row.name)).not.toContain("local_path");
    expect(attachmentColumns.map((row) => row.name)).not.toContain("original_local_path");

    const entryColumns = await backend.select<{ name: string }>("PRAGMA table_info(entries)");
    expect(entryColumns.map((row) => row.name)).not.toContain("body");
    await backend.close();
  });

  it("applies the schema idempotently", async () => {
    const backend = await MemorySqliteBackend.open([]);
    await ensureMigrated(backend);
    await ensureMigrated(backend);
    const tables = await backend.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries'"
    );
    expect(tables).toHaveLength(1);
    await backend.close();
  });

  it("continues from an already-v1 database (upgrade path)", async () => {
    const backend = await MemorySqliteBackend.open([]);
    await ensureMigrated(backend, [{ version: 1, sql: SCHEMA_SQL }]);
    expect((await backend.select<{ user_version: number }>("PRAGMA user_version"))[0].user_version).toBe(1);
    await ensureMigrated(backend);
    expect((await backend.select<{ user_version: number }>("PRAGMA user_version"))[0].user_version).toBe(10);
    await backend.close();
  });

  it("folds body into note when upgrading from v2", async () => {
    const backend = await MemorySqliteBackend.open([]);
    await ensureMigrated(backend, [
      { version: 1, sql: SCHEMA_SQL },
      { version: 2, sql: SCHEMA_V2_SQL },
    ]);
    await backend.execute(
      `INSERT INTO entries (id, modality, title, note, body, date, all_day, created_at)
       VALUES ('x1', 'task', 'T1', 'short note', 'long\nbody', '2026-08-01', 1, '2026-08-01 00:00')`
    );
    await backend.execute(
      `INSERT INTO entries (id, modality, title, note, body, date, all_day, created_at)
       VALUES ('x2', 'task', 'T2', NULL, 'body only', '2026-08-01', 1, '2026-08-01 00:00')`
    );
    await ensureMigrated(backend);
    expect((await backend.select<{ user_version: number }>("PRAGMA user_version"))[0].user_version).toBe(10);
    const rows = await backend.select<{ id: string; note: string | null }>("SELECT id, note FROM entries ORDER BY id");
    expect(rows[0].note).toBe("short note\n\nlong\nbody");
    expect(rows[1].note).toBe("body only");
    await backend.close();
  });

  it("reports a healthy database and ships both DDL assets", async () => {
    const backend = await MemorySqliteBackend.open([]);
    await ensureMigrated(backend);
    await expect(verifyIntegrity(backend)).resolves.toBeUndefined();
    await backend.close();
    expect(SCHEMA_SQL).toContain("CREATE TABLE entries");
    expect(SCHEMA_V2_SQL).toContain("CREATE TABLE timer_session");
    expect(SCHEMA_V2_SQL).toContain("original_local_path");
    expect(SCHEMA_V3_SQL).toContain("DROP COLUMN body");
    expect(SCHEMA_V4_SQL).toContain("reasoning_content");
    expect(SCHEMA_V5_SQL).toContain("WHERE modality = 'idea'");
    expect(SCHEMA_V6_SQL).toContain("SET amount = abs(amount)");
    expect(SCHEMA_V8_SQL).toContain("CREATE TABLE deleted_entries");
    expect(SCHEMA_V9_SQL).toContain("ADD COLUMN mode");
    expect(SCHEMA_V10_SQL).toContain("CREATE TABLE ai_capture_reviews");
    // The parsed review is device-local: it must never enter the sync journal.
    expect(SCHEMA_V10_SQL).not.toContain("sync_changes");
  });

  it("labels existing conversations with their composer when upgrading from v8", async () => {
    const backend = await MemorySqliteBackend.open([]);
    await ensureMigrated(backend, MIGRATION_STEPS.filter((step) => step.version <= 8));
    await backend.execute(
      `INSERT INTO ai_conversations (id, provider_kind, title, created_at, updated_at)
       VALUES ('c1', 'openai-compatible', '随心记 明天开会', '2026-08-01 00:00', '2026-08-01 00:00'),
              ('c2', 'openai-compatible', '随心问 上周花了多少', '2026-08-01 00:00', '2026-08-01 00:00'),
              ('c3', 'openai-compatible', NULL, '2026-08-01 00:00', '2026-08-01 00:00')`
    );
    await ensureMigrated(backend);
    const rows = await backend.select<{ id: string; mode: string }>("SELECT id, mode FROM ai_conversations ORDER BY id");
    expect(rows).toEqual([
      { id: "c1", mode: "capture" },
      { id: "c2", mode: "ask" },
      { id: "c3", mode: "ask" },
    ]);
    await backend.close();
  });

  it("clears idea priority metadata when upgrading from v4", async () => {
    const backend = await MemorySqliteBackend.open([]);
    await ensureMigrated(backend, [
      { version: 1, sql: SCHEMA_SQL },
      { version: 2, sql: SCHEMA_V2_SQL },
      { version: 3, sql: SCHEMA_V3_SQL },
      { version: 4, sql: SCHEMA_V4_SQL },
    ]);
    await backend.execute(
      `INSERT INTO entries (id, modality, title, priority, urgency, date, all_day, created_at)
       VALUES ('idea', 'idea', 'Idea', 'high', 'low', '2026-08-01', 1, '2026-08-01 00:00')`
    );
    await backend.execute(
      `INSERT INTO entries (id, modality, title, priority, urgency, date, all_day, created_at)
       VALUES ('task', 'task', 'Task', 'high', 'low', '2026-08-01', 1, '2026-08-01 00:00')`
    );
    await ensureMigrated(backend);
    const rows = await backend.select<{ id: string; priority: string | null; urgency: string | null }>(
      "SELECT id, priority, urgency FROM entries ORDER BY id"
    );
    expect(rows).toEqual([
      { id: "idea", priority: null, urgency: null },
      { id: "task", priority: "high", urgency: "low" },
    ]);
    await backend.close();
  });

  it("separates reasoning from the answer when upgrading from v3", async () => {
    const backend = await MemorySqliteBackend.open([]);
    await ensureMigrated(backend, [
      { version: 1, sql: SCHEMA_SQL },
      { version: 2, sql: SCHEMA_V2_SQL },
      { version: 3, sql: SCHEMA_V3_SQL },
    ]);
    await ensureMigrated(backend);
    const conversations = new AiConversationStore(backend);
    const conversation = await conversations.createConversation({
      providerKind: "local-openai-compatible", baseUrl: "http://localhost/v1", model: "test",
    });
    const message = await conversations.appendMessage(conversation.id, {
      role: "assistant", content: "Visible answer", reasoningContent: "Hidden reasoning",
    });
    expect(message.reasoningContent).toBe("Hidden reasoning");
    await backend.close();
  });

  it("stores bill amounts as magnitudes when upgrading from v5", async () => {
    const backend = await MemorySqliteBackend.open([]);
    await ensureMigrated(backend, [
      { version: 1, sql: SCHEMA_SQL },
      { version: 2, sql: SCHEMA_V2_SQL },
      { version: 3, sql: SCHEMA_V3_SQL },
      { version: 4, sql: SCHEMA_V4_SQL },
      { version: 5, sql: SCHEMA_V5_SQL },
    ]);
    await backend.execute(
      `INSERT INTO entries (id, modality, title, amount, date, created_at)
       VALUES ('income', 'bill', 'Salary', -120.5, '2026-08-01', '2026-08-01 00:00'),
              ('expense', 'bill', 'Lunch', -28, '2026-08-01', '2026-08-01 00:00')`
    );
    await ensureMigrated(backend);
    const rows = await backend.select<{ id: string; amount: number }>(
      "SELECT id, amount FROM entries ORDER BY id"
    );
    expect(rows).toEqual([
      { id: "expense", amount: 28 },
      { id: "income", amount: 120.5 },
    ]);
    await backend.close();
  });
});
