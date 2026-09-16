import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TIMER_HEARTBEAT_MS,
  createTimerSession,
  finalizeTimerSegments,
  isTimerRunning,
  pauseTimerSession,
  recoverTimerSession,
  resumeTimerSession,
  timerElapsedMs,
  updateTimerSession,
  type TimerDetails,
  type TimerSegment,
  type TimerSession,
  type TimerStartOptions
} from "@chronoeon/domain";
import type { TimerStore } from "@chronoeon/storage";
import { isTauri } from "../platform/desktop";
import { backgroundTimingSupported, backgroundTimerSnapshot, syncBackgroundTimer } from "../platform/background";

/**
 * Live stopwatch. On the desktop the `timer_session` SQLite row is the single
 * source of truth — every state change and heartbeat persists, and the
 * existing recovery semantics (`recoverTimerSession`) cap an interrupted
 * segment at the last heartbeat, so app-off time is never billed. The browser
 * demo keeps the localStorage fallback.
 */

const STORAGE_KEY = "chronoeon.timer.active";

function readLocalSession(): TimerSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimerSession;
    return parsed && Array.isArray(parsed.segments) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalSession(session: TimerSession | null): void {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable in a hardened browser profile.
  }
}

export interface LiveTimer {
  session: TimerSession | null;
  ready: boolean;
  finishing: boolean;
  running: boolean;
  active: boolean;
  elapsed: number;
  /** True when offline time was discarded and the user should confirm. */
  recovered: boolean;
  start: (options: TimerStartOptions) => void;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  cancel: () => void;
  /** Edit title/location/note/photos while the clock keeps running. */
  update: (patch: TimerDetails & { title?: string }) => void;
  dismissRecovered: () => void;
}

export type TimerLifecycleEvent = "start" | "pause" | "resume" | "stop" | "cancel";

export function useLiveTimer(
  timerStore: TimerStore | null,
  onFinish: (segments: TimerSegment[], session: TimerSession) => Promise<void> | void,
  onEvent?: (event: TimerLifecycleEvent, session: TimerSession, elapsedMs: number) => void,
  onError?: (error: unknown) => void,
): LiveTimer {
  const nativeTiming = backgroundTimingSupported();
  const [session, setSession] = useState<TimerSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [recovered, setRecovered] = useState(false);
  const [ready, setReady] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const sessionRef = useRef<TimerSession | null>(null);
  const finishingRef = useRef<Promise<void> | null>(null);
  const savedRef = useRef<string | null>(null);
  const hydrated = useRef(false);
  const eventRef = useRef(onEvent); eventRef.current = onEvent;
  const errorRef = useRef(onError); errorRef.current = onError;

  const replace = useCallback((next: TimerSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);
  const persist = useCallback(async (next: TimerSession | null) => {
    if (timerStore) {
      await timerStore.save(next);
      if (nativeTiming) await syncBackgroundTimer();
      return;
    }
    if (isTauri()) throw new Error("Timer storage is not ready");
    writeLocalSession(next);
  }, [nativeTiming, timerStore]);
  const persistInBackground = useCallback((next: TimerSession | null) => {
    void persist(next).catch((error) => errorRef.current?.(error));
  }, [persist]);

  useEffect(() => {
    // A native launch must wait for SQLite, never read the demo's localStorage.
    if (isTauri() && !timerStore) return;
    let disposed = false;
    void (async () => {
      const stored = nativeTiming ? (await backgroundTimerSnapshot()).session : timerStore ? await timerStore.load() : readLocalSession();
      if (disposed) return;
      if (!(hydrated.current && sessionRef.current) && stored) {
        const recovery = recoverTimerSession(stored, Date.now());
        replace(recovery.session);
        setRecovered(recovery.recovered);
        setNow(Date.now());
        if (recovery.recovered) persistInBackground(recovery.session);
      }
      if (nativeTiming) await syncBackgroundTimer();
      if (disposed) return;
      hydrated.current = true;
      setReady(true);
    })().catch((error) => { if (!disposed) errorRef.current?.(error); });
    return () => { disposed = true; };
  }, [nativeTiming, persistInBackground, replace, timerStore]);

  const running = isTimerRunning(session);
  useEffect(() => {
    if (!running) return;
    let sinceHeartbeat = 0;
    let id: number | undefined;
    let disposed = false;
    const tick = () => {
      const current = sessionRef.current;
      if (!isTimerRunning(current) || finishingRef.current) return;
      setNow(Date.now());
      // The Android service owns its minute heartbeat even when the WebView is
      // suspended. The UI only paints the clock while it is actually visible.
      if (nativeTiming) return;
      sinceHeartbeat += 1000;
      if (sinceHeartbeat < TIMER_HEARTBEAT_MS) return;
      sinceHeartbeat = 0;
      const updated = { ...current!, lastTick: Date.now() };
      replace(updated); persistInBackground(updated);
    };
    const visible = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
      if (nativeTiming && document.hidden) return;
      tick(); id = window.setInterval(tick, 1000);
      if (nativeTiming) {
        const before = sessionRef.current;
        void backgroundTimerSnapshot().then(({ session: stored }) => {
          if (disposed || sessionRef.current !== before || finishingRef.current) return;
          if (!stored) { replace(null); return; }
          const recovery = recoverTimerSession(stored, Date.now());
          replace(recovery.session); setRecovered(recovery.recovered); setNow(Date.now());
          if (recovery.recovered) persistInBackground(recovery.session);
        }).catch(error => errorRef.current?.(error));
      }
    };
    // Do not count the immediate first paint as a persistence heartbeat.
    if (!nativeTiming || !document.hidden) id = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; if (id !== undefined) window.clearInterval(id); document.removeEventListener("visibilitychange", visible); };
  }, [nativeTiming, persistInBackground, replace, running]);

  useEffect(() => {
    function onBeforeUnload() {
      const current = sessionRef.current;
      if (!nativeTiming && isTimerRunning(current)) persistInBackground({ ...current!, lastTick: Date.now() });
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [nativeTiming, persistInBackground]);

  const start = useCallback((options: TimerStartOptions) => {
    if (!ready || sessionRef.current || finishingRef.current) return;
    const startedAt = Date.now();
    const next = createTimerSession(options, startedAt);
    savedRef.current = null;
    replace(next);
    setRecovered(false);
    setNow(startedAt);
    persistInBackground(next);
    eventRef.current?.("start", next, 0);
  }, [persistInBackground, ready, replace]);

  const pause = useCallback(() => {
    const current = sessionRef.current;
    if (!isTimerRunning(current) || finishingRef.current) return;
    const at = Date.now();
    const updated = pauseTimerSession(current!, at);
    replace(updated);
    setNow(at);
    persistInBackground(updated);
    eventRef.current?.("pause", updated, timerElapsedMs(updated, at));
  }, [persistInBackground, replace]);

  const resume = useCallback(() => {
    const current = sessionRef.current;
    if (!current || isTimerRunning(current) || finishingRef.current || savedRef.current === current.id) return;
    const at = Date.now();
    const updated = resumeTimerSession(current, at);
    replace(updated);
    persistInBackground(updated);
    setRecovered(false);
    setNow(at);
    eventRef.current?.("resume", updated, timerElapsedMs(updated, at));
  }, [persistInBackground, replace]);

  const stop = useCallback((): Promise<void> => {
    if (finishingRef.current) return finishingRef.current;
    const current = sessionRef.current;
    if (!current) return Promise.resolve();
    const at = Date.now();
    const paused = pauseTimerSession(current, at);
    replace(paused);
    setNow(at);
    setFinishing(true);
    // Keep a durable paused session until entry creation has succeeded. Failed
    // saves are retryable and cannot lose a recording or bill time spent retrying.
    const finish = (async () => {
      if (savedRef.current !== current.id) {
        await persist(paused);
        const segments = finalizeTimerSegments(paused, at);
        if (segments.length) await onFinish(segments, paused);
        savedRef.current = current.id;
      }
      await persist(null);
      replace(null);
      setRecovered(false);
      eventRef.current?.("stop", paused, timerElapsedMs(paused, at));
    })().finally(() => { finishingRef.current = null; setFinishing(false); });
    finishingRef.current = finish;
    return finish;
  }, [onFinish, persist, replace]);

  const cancel = useCallback(() => {
    if (finishingRef.current) return;
    const current = sessionRef.current;
    replace(null);
    setRecovered(false);
    persistInBackground(null);
    if (current) eventRef.current?.("cancel", current, timerElapsedMs(current, Date.now()));
  }, [persistInBackground, replace]);

  const update = useCallback((patch: TimerDetails & { title?: string }) => {
    const current = sessionRef.current;
    if (!current || finishingRef.current || savedRef.current === current.id) return;
    const updated = updateTimerSession(current, patch);
    replace(updated);
    persistInBackground(updated);
  }, [persistInBackground, replace]);
  const dismissRecovered = useCallback(() => setRecovered(false), []);
  const elapsed = useMemo(() => timerElapsedMs(session, now), [now, session]);

  return { session, ready, finishing, running, active: Boolean(session), elapsed, recovered, start, pause, resume, stop, cancel, update, dismissRecovered };
}
