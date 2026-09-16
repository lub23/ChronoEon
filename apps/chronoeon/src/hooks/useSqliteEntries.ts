import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Entry } from "@chronoeon/domain";
import type { EntryRepositoryEvent } from "@chronoeon/ports";
import type { SqliteEntryStore } from "@chronoeon/storage";

export interface SqliteEntries {
  entries: Entry[];
  /** Raw `updated_at` per entry id, kept fresh by store events. */
  revisions: ReadonlyMap<string, string>;
  reload: () => Promise<void>;
}

function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((left, right) => {
    const dateCompare = left.date.localeCompare(right.date);
    if (dateCompare !== 0) return dateCompare;
    const startCompare = (left.start ?? "99:99").localeCompare(right.start ?? "99:99");
    if (startCompare !== 0) return startCompare;
    return left.id.localeCompare(right.id);
  });
}

interface CacheSession {
  store: SqliteEntryStore; alive: boolean; loaded: boolean; epoch: number; loading: Promise<void> | null;
}

/**
 * Store-backed entry cache. Boot loads `store.list()` and reads the revision
 * map; store events (`created`/`updated`/`deleted`) are the single source of
 * state changes, so every write surface stays consistent.
 */
export function useSqliteEntries(store: SqliteEntryStore | null): SqliteEntries {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [revisions, setRevisions] = useState<Map<string, string>>(new Map());
  const sessionRef = useRef<CacheSession | null>(null);

  const applyEvent = useCallback((event: EntryRepositoryEvent) => {
    if (event.type === "rebuilt") return;
    if (event.type === "deleted") {
      setEntries((current) => current.filter((entry) => entry.id !== event.id));
      setRevisions((current) => {
        const next = new Map(current);
        next.delete(event.id);
        return next;
      });
      return;
    }
    const { entry, revision } = event.snapshot;
    const rawRevision = revision.startsWith("v1:") ? revision.slice(3) : revision;
    setEntries((current) => current.some((candidate) => candidate.id === entry.id)
      ? current.map((candidate) => candidate.id === entry.id ? entry : candidate)
      : [...current, entry]);
    setRevisions((current) => {
      const next = new Map(current);
      if (rawRevision) next.set(entry.id, rawRevision);
      return next;
    });
  }, []);

  const reload = useCallback((): Promise<void> => {
    const session = sessionRef.current;
    if (!store || !session?.alive || session.store !== store) return Promise.resolve();
    session.loading ??= (async () => {
      // A remote apply or local edit arriving during a read invalidates that
      // read. Never overwrite a fresh event with an older boot snapshot.
      while (session.alive) {
        const epoch = session.epoch;
        const loaded = await store.list();
        const raw = await store.readRevisions(loaded.map((entry) => entry.id));
        if (!session.alive) return;
        if (epoch !== session.epoch) continue;
        setEntries(loaded); setRevisions(raw); session.loaded = true; return;
      }
    })().finally(() => { session.loading = null; });
    return session.loading;
  }, [store]);

  useEffect(() => {
    if (!store) { setEntries([]); setRevisions(new Map()); return; }
    const session: CacheSession = { store, alive: true, loaded: false, epoch: 0, loading: null };
    sessionRef.current = session;
    const refresh = () => { void reload().catch((error) => console.warn("Could not refresh local entries", error)); };
    // Subscribe before the first read so background attachment ingestion and
    // very early sync changes cannot fall into a boot-time subscription gap.
    const unsubscribe = store.subscribe((event) => {
      session.epoch += 1;
      if (event.type === "rebuilt" || !session.loaded || session.loading) refresh();
      else applyEvent(event);
    });
    refresh();
    return () => { session.alive = false; unsubscribe(); };
  }, [applyEvent, reload, store]);

  const sorted = useMemo(() => sortEntries(entries), [entries]);
  return { entries: sorted, revisions, reload };
}
