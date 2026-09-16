import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SyncEngine, stableJson, type MissingAttachmentDetail, type SyncConflict, type SyncLocalStatus, type SyncStore } from "@chronoeon/storage";
import { NativeSyncBackend, prepareAttachmentImports } from "./client";
import { SyncScheduler } from "./scheduler";
import { syncConfigured, type SyncConfig, type SyncResult } from "./types";

export interface SyncServiceState {
  busy: boolean; result: SyncResult | null; status: SyncLocalStatus | null; conflicts: SyncConflict[]; missingAttachments: MissingAttachmentDetail[];
}
export function useSyncService(journal: SyncStore | null, config: SyncConfig, settings: Record<string, unknown>, callbacks: {
  importSettings: (settings: Record<string, unknown>) => void; onApplied: () => Promise<void>; onConflicts: (count: number) => void;
}) {
  const [state, setState] = useState<SyncServiceState>({ busy: false, result: null, status: null, conflicts: [], missingAttachments: [] });
  const backend = useMemo(() => new NativeSyncBackend(config), [config]);
  const [ready, setReady] = useState<SyncStore | null>(null);
  const refs = useRef({ settings, callbacks }); refs.current = { settings, callbacks };
  const scheduler = useRef<SyncScheduler | null>(null);
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
    if (!journal || ready !== journal) return;
    const payload = stableJson(settings);
    // A fresh device must not compete with remote preferences using untouched
    // defaults. A real local edit, or an initialized settings row, is journaled.
    if (payload !== persisted.current.payload && (persisted.current.seeded || persisted.current.payload)) {
      persisted.current = { seeded: true, payload };
      void journal.setSettings(settings).then(refresh);
    }
  }, [journal, ready, refresh, settings]);

  useEffect(() => {
    if (!journal || ready !== journal || !syncConfigured(config)) { setState((current) => current.busy ? { ...current, busy: false } : current); return; }
    let disposed = false;
    const engine = new SyncEngine(journal, backend, {
      deviceName: /Android/i.test(navigator.userAgent) ? "Android" : /iPhone|iPad/i.test(navigator.userAgent) ? "iOS" : navigator.platform || "ChronoEon",
      cancelled: () => disposed,
      prepareAttachments: () => prepareAttachmentImports(journal),
      beforePublish: async () => {
        if (!(await journal.getSettings())) {
          await journal.setSettings(refs.current.settings);
          persisted.current = { seeded: true, payload: stableJson(refs.current.settings) };
        }
      },
      onApplied: async () => { await applySettings(); await refs.current.callbacks.onApplied(); },
    });
    const service = new SyncScheduler(engine, { subscribe: (listener) => journal.subscribe(listener), flush: () => journal.flush(), status: () => journal.status(backend.id) }, (result, busy) => {
      if (disposed) return;
      if (result) resultRef.current = result instanceof Error ? { ok: false, code: result.message.split(":")[0], message: result.message } : result;
      setState((current) => ({ ...current, busy, result: result ? resultRef.current : current.result }));
      if (!busy) void refresh();
    });
    scheduler.current = service;
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
      window.removeEventListener("online", wake); window.removeEventListener("pagehide", wake);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [applySettings, backend, config, journal, ready, refresh]);
  const trigger = useCallback(async (rebuildSnapshot: boolean): Promise<SyncResult | null> => {
    const current = scheduler.current;
    if (!current) return { ok: false, code: "SYNC_NOT_READY", message: "Synchronization is not ready" };
    await current.trigger({ rebuildSnapshot });
    if (scheduler.current !== current) return { ok: false, code: "SYNC_CANCELLED", message: "Synchronization settings changed" };
    if (rebuildSnapshot && resultRef.current?.ok) await refs.current.callbacks.onApplied();
    await refresh();
    return resultRef.current;
  }, [refresh]);
  const run = useCallback(() => trigger(false), [trigger]);
  const rebuildSnapshot = useCallback(() => trigger(true), [trigger]);
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
  return { ...state, available: Boolean(journal && ready === journal && syncConfigured(config)), run, rebuildSnapshot, resolve, removeMissingAttachment, clearMissingAttachments };
}
