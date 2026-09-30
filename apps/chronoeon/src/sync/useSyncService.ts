import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEntryId, type ChronoEonSettings, type LedgerImportPayload, type LedgerImportSummary } from "@chronoeon/domain";
import { SyncEngine, stableJson, type MissingAttachmentDetail, type SyncConflict, type SyncLocalStatus, type SyncStore } from "@chronoeon/storage";
import { NativeSyncBackend, fetchStorageUsage, prepareAttachmentImports } from "./client";
import { SyncScheduler } from "./scheduler";
import { syncConfigured, type StorageUsage, type SyncConfig, type SyncResult } from "./types";

export interface LedgerReplacementResult {
  summary: LedgerImportSummary & { replacedCount: number };
  backupPath: string;
}
export class LedgerReplacementError extends Error {
  constructor(message: string, readonly backupPath: string | null, readonly ledgerReplaced: boolean, cause: unknown) {
    super(message, { cause });
    this.name = "LedgerReplacementError";
  }
}

function catalogSignature(payload: Record<string, unknown>): string {
  const settings = payload.settings as ChronoEonSettings | undefined;
  return stableJson(settings?.calendars.find(calendar => calendar.id === settings.defaultCalendarID)?.billCategories);
}

export interface SyncServiceState {
  busy: boolean; result: SyncResult | null; status: SyncLocalStatus | null; conflicts: SyncConflict[]; missingAttachments: MissingAttachmentDetail[];
  usage: StorageUsage | null;
}
export function useSyncService(journal: SyncStore | null, config: SyncConfig, settings: Record<string, unknown>, callbacks: {
  importSettings: (settings: Record<string, unknown>) => void; onApplied: () => Promise<void>; onConflicts: (count: number) => void;
  onMaintenance?: (active: boolean) => void | Promise<void>;
}) {
  const [state, setState] = useState<SyncServiceState>({ busy: false, result: null, status: null, conflicts: [], missingAttachments: [], usage: null });
  const backend = useMemo(() => new NativeSyncBackend(config), [config]);
  const [ready, setReady] = useState<SyncStore | null>(null);
  const refs = useRef({ settings, callbacks }); refs.current = { settings, callbacks };
  const scheduler = useRef<SyncScheduler | null>(null);
  const executor = useRef<{ scheduler: SyncScheduler; engine: SyncEngine; journal: SyncStore } | null>(null);
  const maintenance = useRef(false);
  const maintenanceEngine = useRef<SyncEngine | null>(null);
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const settingsGuard = useRef<string | null>(null);
  const beforeMaintenancePublish = useRef<(() => Promise<void>) | null>(null);
  const pendingLedgerSnapshot = useRef(false);
  const resultRef = useRef<SyncResult | null>(null);
  const persisted = useRef({ seeded: false, payload: "" });
  const conflictSignature = useRef("");
  const refresh = useCallback(async () => {
    if (!journal) return;
    const [status, conflicts, missingAttachments] = await Promise.all([journal.status(backend.id), journal.conflicts(), journal.missingAttachmentDetails()]);
    setState((current) => ({ ...current, status, conflicts, missingAttachments }));
    const signature = conflicts.map((conflict) => `${conflict.entity}/${conflict.id}/${conflict.field}/${conflict.versions.map((version) => version.operationId).join(",")}`).join("|");
    if (signature && signature !== conflictSignature.current) refs.current.callbacks.onConflicts(conflicts.length);
    conflictSignature.current = signature;
  }, [backend.id, journal]);
  const applySettings = useCallback(async () => {
    const payload = await journal?.getSettings();
    if (payload) {
      persisted.current = { seeded: true, payload: stableJson(payload) };
      if (maintenance.current) settingsGuard.current = catalogSignature(payload);
      refs.current.callbacks.importSettings(payload);
    }
  }, [journal]);
  useEffect(() => {
    let disposed = false;
    if (!journal) return;
    persisted.current = { seeded: false, payload: stableJson(refs.current.settings) };
    void applySettings().then(() => { if (!disposed) setReady(journal); }).catch((error) => {
      if (!disposed) setState((current) => ({ ...current, result: { ok:false,code:"SYNC_SETTINGS_INVALID",message:String(error) } }));
    });
    const unsubscribe = journal.subscribe(() => { if (!disposed) void refresh(); });
    void refresh();
    return () => { disposed = true; unsubscribe(); };
  }, [applySettings, journal, refresh]);
  useEffect(() => {
    if (!journal || ready !== journal || maintenance.current) return;
    // React may still render the pre-import preference while the persisted
    // category list has already changed. Wait for its imported catalog before
    // allowing settings effects to write again.
    if (settingsGuard.current !== null) {
      if (catalogSignature(settings) !== settingsGuard.current) return;
      settingsGuard.current = null;
    }
    const payload = stableJson(settings);
    // A fresh device must not compete with remote preferences using untouched
    // defaults. A real local edit, or an initialized settings row, is journaled.
    if (payload !== persisted.current.payload && (persisted.current.seeded || persisted.current.payload)) {
      persisted.current = { seeded: true, payload };
      void journal.setSettings(settings).then(refresh);
    }
  }, [journal, maintenanceActive, ready, refresh, settings]);

  useEffect(() => {
    if (!journal || ready !== journal || !syncConfigured(config)) { setState((current) => current.busy ? { ...current, busy: false } : current); return; }
    let disposed = false;
    const engine: SyncEngine = new SyncEngine(journal, backend, {
      deviceName: /Android/i.test(navigator.userAgent) ? "Android" : /iPhone|iPad/i.test(navigator.userAgent) ? "iOS" : navigator.platform || "ChronoEon",
      cancelled: () => disposed || (maintenance.current && maintenanceEngine.current !== engine),
      prepareAttachments: () => prepareAttachmentImports(journal),
      beforePublish: async () => {
        await beforeMaintenancePublish.current?.();
        if (!(await journal.getSettings())) {
          await journal.setSettings(refs.current.settings);
          persisted.current = { seeded: true, payload: stableJson(refs.current.settings) };
        }
      },
      onApplied: async () => { await applySettings(); await refs.current.callbacks.onApplied(); },
    });
    const service = new SyncScheduler({ run: (options) => engine.run({ ...options, rebuildSnapshot: Boolean(options?.rebuildSnapshot || pendingLedgerSnapshot.current) }) }, { subscribe: (listener) => journal.subscribe(listener), flush: () => journal.flush(), status: () => journal.status(backend.id) }, (result, busy) => {
      if (disposed) return;
      if (result && !(result instanceof Error) && result.snapshotCreated && pendingLedgerSnapshot.current) {
        pendingLedgerSnapshot.current = false;
        beforeMaintenancePublish.current = null;
      }
      if (result) resultRef.current = result instanceof Error ? { ok: false, code: result.message.split(":")[0], message: result.message } : result;
      setState((current) => ({ ...current, busy, result: result ? resultRef.current : current.result }));
      if (!busy) void refresh();
    });
    scheduler.current = service;
    const active = { scheduler: service, engine, journal };
    executor.current = active;
    // Do not start connection attempts halfway through typing a URL or token.
    const boot = setTimeout(() => service.start(), 800);
    const wake = () => { void service.trigger(); };
    const visibility = () => { wake(); };
    window.addEventListener("online", wake);
    window.addEventListener("pagehide", wake);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true; clearTimeout(boot); service.dispose();
      if (scheduler.current === service) scheduler.current = null;
      if (executor.current === active) executor.current = null;
      window.removeEventListener("online", wake); window.removeEventListener("pagehide", wake);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [applySettings, backend, config, journal, ready, refresh]);
  // Folder walks are cheap but not free; measure only when the panel asks and
  // after each completed run, never on every journal change.
  const refreshUsage = useCallback(async () => {
    if (!journal) return;
    try { const usage = await fetchStorageUsage(config); setState((current) => ({ ...current, usage })); }
    catch { setState((current) => ({ ...current, usage: null })); }
  }, [config, journal]);
  const trigger = useCallback(async (rebuildSnapshot: boolean): Promise<SyncResult | null> => {
    const current = scheduler.current;
    if (!current) return { ok: false, code: "SYNC_NOT_READY", message: "Synchronization is not ready" };
    await current.trigger({ rebuildSnapshot });
    if (scheduler.current !== current) return { ok: false, code: "SYNC_CANCELLED", message: "Synchronization settings changed" };
    if (rebuildSnapshot && resultRef.current?.ok) await refs.current.callbacks.onApplied();
    await refresh();
    void refreshUsage();
    return resultRef.current;
  }, [refresh, refreshUsage]);
  const run = useCallback(() => trigger(false), [trigger]);
  const rebuildSnapshot = useCallback(() => trigger(true), [trigger]);
  const replaceLedger = useCallback(async (payload: LedgerImportPayload): Promise<LedgerReplacementResult> => {
    const active = executor.current;
    if (!active || active.scheduler !== scheduler.current) throw new Error("SYNC_NOT_READY");
    if (maintenance.current) throw new Error("SYNC_MAINTENANCE_BUSY");
    maintenance.current = true;
    maintenanceEngine.current = active.engine;
    setMaintenanceActive(true);
    let backupPath: string | null = null;
    let ledgerReplaced = false;
    let snapshotPublished = false;
    const assertActive = () => {
      if (executor.current !== active || scheduler.current !== active.scheduler) throw new Error("SYNC_CANCELLED");
    };
    try {
      await refs.current.callbacks.onMaintenance?.(true);
      return await active.scheduler.runExclusive(async () => {
        const [{ createSqliteStoreSession }, { appLocalDataDir, join }] = await Promise.all([
          import("../platform/sqliteSession"), import("@tauri-apps/api/path"),
        ]);
        const session = await createSqliteStoreSession();
        assertActive();
        if (!session || session.sync !== active.journal) throw new Error("SYNC_NOT_READY");
        const pulled = await active.engine.run({ pullOnly: true });
        assertActive();
        if (pulled.conflicts) throw new Error("LEDGER_UNRESOLVED_CONFLICTS");
        backupPath = await join(await appLocalDataDir(), `ledger-backup-${new Date().toISOString().replaceAll(":", "-")}-${createEntryId()}.db`);
        await session.store.backup(backupPath);
        assertActive();
        // The pull may have changed the catalog. Never import against stale
        // React preferences, or touch bills before the backup was verified.
        const bundle = await active.journal.getSettings();
        if (!bundle?.settings) throw new Error("LEDGER_SETTINGS_MISSING");
        assertActive();
        const summary = await session.store.replaceBills(bundle.settings as ChronoEonSettings, payload);
        ledgerReplaced = true;
        pendingLedgerSnapshot.current = true;
        let checkpoint: string | null = null;
        let importedCatalog: string | null = null;
        // A peer can publish while the backup/import is running. The final
        // engine fetch still merges those changes, but must not publish an
        // unverified replacement snapshot with a different ledger/catalog.
        beforeMaintenancePublish.current = async () => {
          assertActive();
          if (checkpoint === null || importedCatalog === null || stableJson(await session.store.list({ kinds: ["bill"] })) !== checkpoint
            || catalogSignature((await active.journal.getSettings()) ?? {}) !== importedCatalog
            || (await active.journal.status()).conflicts) throw new Error("LEDGER_CHANGED_BEFORE_PUBLISH");
        };
        checkpoint = stableJson(await session.store.list({ kinds: ["bill"] }));
        const importedBundle = await active.journal.getSettings();
        if (!importedBundle) throw new Error("LEDGER_SETTINGS_MISSING");
        importedCatalog = catalogSignature(importedBundle);
        await applySettings();
        await refs.current.callbacks.onApplied();
        assertActive();
        const published = await active.engine.run({ rebuildSnapshot: true });
        if (!published.snapshotCreated || published.conflicts) throw new Error("LEDGER_SNAPSHOT_NOT_VERIFIED");
        snapshotPublished = true;
        pendingLedgerSnapshot.current = false;
        resultRef.current = published;
        setState((current) => ({ ...current, result: published }));
        return { summary, backupPath };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result: SyncResult = { ok: false, code: message.split(":")[0], message };
      resultRef.current = result;
      setState((current) => ({ ...current, result }));
      throw new LedgerReplacementError(message, backupPath, ledgerReplaced, error);
    } finally {
      // Keep verification in front of automatic retries after a local commit.
      // A retry is also forced to create the requested logical snapshot.
      if (snapshotPublished) beforeMaintenancePublish.current = null;
      maintenanceEngine.current = null;
      maintenance.current = false;
      setMaintenanceActive(false);
      await refs.current.callbacks.onMaintenance?.(false);
      void refresh();
    }
  }, [applySettings, refresh]);
  const resolve = useCallback(async (conflict: SyncConflict, operationId: string) => {
    if (!journal) return;
    const version = conflict.versions.find((candidate) => candidate.operationId === operationId);
    if (!version) return;
    try { await journal.resolve(conflict.entity, conflict.id, conflict.field, version.value, conflict.clock); }
    catch (error) { await refresh(); throw error; }
    await applySettings(); await refs.current.callbacks.onApplied(); await refresh();
    await scheduler.current?.trigger();
  }, [applySettings, journal, refresh]);
  const removeMissingAttachment = useCallback(async (id: string) => {
    if (!journal) return;
    await journal.removeMissingAttachment(id);
    await refresh();
  }, [journal, refresh]);
  const clearMissingAttachments = useCallback(async () => {
    if (!journal) return;
    await journal.clearMissingAttachments();
    await refresh();
  }, [journal, refresh]);
  return { ...state, busy: state.busy || maintenanceActive, available: Boolean(journal && ready === journal && syncConfigured(config)), run, rebuildSnapshot, replaceLedger, resolve, removeMissingAttachment, clearMissingAttachments, refreshUsage };
}
