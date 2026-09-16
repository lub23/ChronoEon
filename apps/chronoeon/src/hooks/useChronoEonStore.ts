import { useCallback, useEffect, useMemo, useState } from "react";
import { createDemoEntries } from "../data/demo";
import type { ChronoEonSettings, Entry, EntryDraft, EntryStatus } from "../domain/entry";
import { DEFAULT_CHRONOEON_SETTINGS, draftToEntry, resolveEntryColor } from "../domain/entry";
import { entryWithDraft } from "../domain/entryWorkflow";

const STORAGE_KEY = "chronoeon.entries.v1";
const LEGACY_STORAGE_KEY = "chronicle.entries.v1";

function loadEntries(): Entry[] {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Entry[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (error) {
    console.warn("Could not read ChronoEon demo data", error);
  }
  return createDemoEntries();
}

export function useChronoEonStore(settings: ChronoEonSettings = DEFAULT_CHRONOEON_SETTINGS, enabled = true) {
  const [entries, setEntries] = useState<Entry[]>(() => (enabled ? loadEntries() : []));

  useEffect(() => {
    if (!enabled) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage may be unavailable in a hardened browser profile.
    }
  }, [enabled, entries]);

  const add = useCallback((draft: EntryDraft): Entry => {
    const created = draftToEntry(draft, "local", resolveEntryColor(draft.category, draft.kind, settings, draft.calendar));
    if (enabled) setEntries((current) => [...current, created]);
    return created;
  }, [enabled, settings]);

  const prepareUpdate = useCallback((entry: Entry, draft: EntryDraft): Entry => (
    entryWithDraft(entry, draft, settings)
  ), [settings]);

  const update = useCallback((id: string, draft: EntryDraft): Entry | undefined => {
    const currentEntry = entries.find((entry) => entry.id === id);
    if (!currentEntry) return undefined;
    const updated = prepareUpdate(currentEntry, draft);
    setEntries((current) => current.map((entry) => entry.id === id ? updated : entry));
    return updated;
  }, [entries, prepareUpdate]);

  const insert = useCallback((entry: Entry): void => {
    setEntries((current) => current.some((candidate) => candidate.id === entry.id) ? current : [...current, entry]);
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toggleTask = useCallback((id: string) => {
    setEntries((current) => current.map((entry) => entry.id === id && entry.kind === "task"
      ? { ...entry, status: (entry.status === "done" ? "open" : "done") as EntryStatus }
      : entry));
  }, []);

  const convertIdea = useCallback((id: string, date: string) => {
    setEntries((current) => current.map((entry) => entry.id === id
      ? {
          ...entry,
          kind: "task",
          date,
          allDay: true,
          status: "open" as EntryStatus,
          color: resolveEntryColor(entry.category, "task", settings, entry.calendar),
          source: "local"
        }
      : entry));
  }, [settings]);

  const mergeImported = useCallback((incoming: Entry[]): number => {
    // Calculate the count before scheduling the state update. React may defer
    // an updater, so returning a counter assigned inside setEntries would make
    // the workspace toast report zero imported rows intermittently.
    const ids = new Set(entries.map((entry) => entry.id));
    const fresh = incoming.filter((entry) => {
      if (ids.has(entry.id)) return false;
      ids.add(entry.id);
      return true;
    });
    if (fresh.length) setEntries((current) => [...current, ...fresh]);
    return fresh.length;
  }, [entries]);

  const replaceEntries = useCallback((incoming: Entry[]): void => {
    setEntries(incoming);
  }, []);

  const replace = useCallback((id: string, incoming: Entry): void => {
    setEntries((current) => current.map((entry) => entry.id === id ? incoming : entry));
  }, []);

  const sorted = useMemo(() => [...entries].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.start ?? "99:99").localeCompare(b.start ?? "99:99");
  }), [entries]);

  return { entries: sorted, add, insert, prepareUpdate, update, remove, toggleTask, convertIdea, mergeImported, replaceEntries, replace };
}
