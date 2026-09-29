// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultSettings, prepareLedgerReplacement, type LedgerImportPayload } from "@chronoeon/domain";
import type { SyncStore } from "@chronoeon/storage";
import { useSyncService } from "./useSyncService";
import { DEFAULT_SYNC_CONFIG } from "./types";

const runtime = vi.hoisted(() => ({
  log: [] as string[], session: null as any,
  pull: vi.fn(async () => {}), publish: vi.fn(async () => {}), beforeFinalFetch: vi.fn(async () => {}),
}));
vi.mock("@chronoeon/storage", async (load) => {
  const actual = await load<typeof import("@chronoeon/storage")>();
  return { ...actual, SyncEngine: class {
    constructor(_journal: unknown, _backend: unknown, private options: { onApplied: () => Promise<void>; beforePublish: () => Promise<void> }) {}
    async run(options: { pullOnly?: boolean; rebuildSnapshot?: boolean } = {}) {
      const result = { ok: true, sent: 0, received: 1, conflicts: 0, snapshotCreated: false, attachmentCount: 0 };
      if (options.pullOnly) {
        runtime.log.push("pull"); await runtime.pull(); await this.options.onApplied(); return result;
      }
      runtime.log.push("snapshot"); await runtime.beforeFinalFetch(); await this.options.beforePublish();
      await runtime.publish(); runtime.log.push("published"); return { ...result, snapshotCreated: Boolean(options.rebuildSnapshot) };
    }
  } };
});
vi.mock("./client", () => ({
  NativeSyncBackend: class { readonly id = "test-remote"; },
  prepareAttachmentImports: vi.fn(async () => {}), fetchStorageUsage: vi.fn(async () => null),
}));
vi.mock("../platform/sqliteSession", () => ({ createSqliteStoreSession: vi.fn(async () => runtime.session) }));
vi.mock("@tauri-apps/api/path", () => ({ appLocalDataDir: vi.fn(async () => "C:/private"), join: vi.fn(async (...parts: string[]) => parts.join("/")) }));

const parentId = "ledger-" + "a".repeat(24);
const payload: LedgerImportPayload = {
  format: "chronoeon-ledger", version: 1, source: { sha256: "f".repeat(64), sheet: "Transactions" }, currency: "CNY",
  categories: [{ id: parentId, name: "Income", direction: "income", sub: ["Salary"] }],
  transactions: [{ id: "10000000-0000-4000-8000-000000000001", row: 2, date: "2026-09-01", title: "Synthetic",
    categoryId: parentId, subcategory: "Salary", amountCents: 12345, payment: "Cash", tags: [] }],
  summary: { count: 1, incomeCount: 1, expenseCount: 0, incomeCents: 12345, expenseCents: 0, netCents: 12345, firstDate: "2026-09-01", lastDate: "2026-09-01" },
};
let persisted: Record<string, any>, bills: unknown[], initial: Record<string, unknown>;
let host: HTMLDivElement, root: Root, current: ReturnType<typeof useSyncService>;
const journal = {
  status: vi.fn(async () => ({ pending: 0, conflicts: 0, failures: 0, nextAttempt: 0, lastSuccess: null, lastError: null,
    missingAttachments: 0, lastSnapshotAt: null, nextSnapshotAt: null })),
  subscribe: vi.fn(() => vi.fn()), flush: vi.fn(async () => {}), getSettings: vi.fn(async () => structuredClone(persisted)),
  setSettings: vi.fn(async (value: Record<string, unknown>) => { persisted = structuredClone(value); }),
  conflicts: vi.fn(async () => []), missingAttachmentDetails: vi.fn(async () => []),
};
const store = {
  backup: vi.fn(async (_path: string) => { runtime.log.push("backup"); }),
  replaceBills: vi.fn(async (settings: ReturnType<typeof createDefaultSettings>, input: LedgerImportPayload) => {
    runtime.log.push("replace");
    expect(settings).toEqual(persisted.settings);
    const prepared = prepareLedgerReplacement(settings, input, "2026-09-29T00:00:00.000Z");
    persisted.settings.bill.categories = prepared.categories; bills = prepared.entries;
    return { ...prepared.summary, replacedCount: 2 };
  }),
  list: vi.fn(async () => structuredClone(bills)),
};
const callbacks = { importSettings: vi.fn(), onApplied: vi.fn(async () => {}), onConflicts: vi.fn() };
const config = { ...DEFAULT_SYNC_CONFIG, gitRemote: "test-remote" };
function Harness({ settings = initial, configured = true }: { settings?: Record<string, unknown>; configured?: boolean }) {
  current = useSyncService(journal as unknown as SyncStore, configured ? config : DEFAULT_SYNC_CONFIG, settings, callbacks);
  return null;
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); runtime.log.length = 0;
  runtime.pull.mockImplementation(async () => {}); runtime.publish.mockImplementation(async () => {}); runtime.beforeFinalFetch.mockImplementation(async () => {});
  store.backup.mockImplementation(async () => { runtime.log.push("backup"); });
  initial = { format: "chronoeon-settings", version: 1, settings: createDefaultSettings(), preferences: { theme: "dark" } };
  persisted = structuredClone(initial); bills = [];
  runtime.session = { sync: journal, store };
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("pulls, verifies a backup, uses fresh persisted catalogs and publishes a verified forced snapshot", async () => {
  runtime.pull.mockImplementation(async () => { persisted.settings.bill.categories.push({ id: "remote-custom", name: "Remote", direction: "expense", color: "#777777", sub: [] }); });
  let result!: Awaited<ReturnType<typeof current.replaceLedger>>;
  await act(async () => { result = await current.replaceLedger(payload); });
  expect(runtime.log).toEqual(["pull", "backup", "replace", "snapshot", "published"]);
  expect(result.summary).toEqual({ ...payload.summary, replacedCount: 2 });
  expect(result.backupPath).toMatch(/^C:\/private\/ledger-backup-.+\.db$/);
  expect(callbacks.importSettings).toHaveBeenLastCalledWith(persisted);
  expect(current.result).toMatchObject({ ok: true, snapshotCreated: true });
  expect(current.busy).toBe(false);
  expect(journal.setSettings).not.toHaveBeenCalled();
  // Even though the harness deliberately kept rendering old preferences during
  // import, they did not overwrite the just-imported category array.
  await act(async () => { root.render(<Harness settings={structuredClone(persisted)} />); });
  expect(journal.setSettings).not.toHaveBeenCalled();
  const changed = structuredClone(persisted); changed.preferences.theme = "light";
  await act(async () => { root.render(<Harness settings={changed} />); });
  expect(journal.setSettings).toHaveBeenLastCalledWith(changed);
});

it("does not back up, replace or publish if the required pull fails", async () => {
  runtime.pull.mockRejectedValueOnce(new Error("SYNC_REMOTE_EMPTY"));
  await act(async () => { await expect(current.replaceLedger(payload)).rejects.toThrow("SYNC_REMOTE_EMPTY"); });
  expect(runtime.log).toEqual(["pull"]);
  expect(store.backup).not.toHaveBeenCalled(); expect(store.replaceBills).not.toHaveBeenCalled(); expect(runtime.publish).not.toHaveBeenCalled();
});

it("does not erase anything when the backup fails", async () => {
  store.backup.mockRejectedValueOnce(new Error("LEDGER_BACKUP_INVALID"));
  await act(async () => { await expect(current.replaceLedger(payload)).rejects.toThrow("LEDGER_BACKUP_INVALID"); });
  expect(store.replaceBills).not.toHaveBeenCalled(); expect(runtime.publish).not.toHaveBeenCalled();
});

it("refuses to publish an unverified snapshot if a remote bill changed after the initial pull", async () => {
  runtime.beforeFinalFetch.mockImplementation(async () => { bills.push({ id: "another-bill" }); });
  await act(async () => { await expect(current.replaceLedger(payload)).rejects.toThrow("LEDGER_CHANGED_BEFORE_PUBLISH"); });
  expect(store.replaceBills).toHaveBeenCalledOnce(); expect(runtime.publish).not.toHaveBeenCalled();
  // The next automatic/manual attempt cannot bypass the failed verification.
  await act(async () => { await current.run(); });
  expect(runtime.publish).not.toHaveBeenCalled();
});

it("retains the backup path on a post-commit network failure and forces a verified snapshot on retry", async () => {
  runtime.publish.mockRejectedValueOnce(new Error("SYNC_OFFLINE"));
  await act(async () => {
    await expect(current.replaceLedger(payload)).rejects.toMatchObject({ ledgerReplaced: true, backupPath: expect.stringMatching(/ledger-backup-.+\.db$/) });
  });
  await act(async () => { await current.run(); });
  expect(current.result).toMatchObject({ ok: true, snapshotCreated: true });
  expect(runtime.publish).toHaveBeenCalledTimes(2);
});

it("requires configured native sync and refuses a different database session", async () => {
  runtime.session = { sync: {}, store };
  await act(async () => { await expect(current.replaceLedger(payload)).rejects.toThrow("SYNC_NOT_READY"); });
  expect(runtime.log).toEqual([]);
  await act(async () => { root.render(<Harness configured={false} />); });
  await act(async () => { await expect(current.replaceLedger(payload)).rejects.toThrow("SYNC_NOT_READY"); });
  expect(store.replaceBills).not.toHaveBeenCalled();
});
