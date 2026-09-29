import { useCallback, useEffect, useRef, useState } from "react";
import type { Item } from "@chronoeon/domain";
import type { ItemStore } from "@chronoeon/ports";

/** Disposable UI projection; SQLite remains the native source of truth. */
export function useSqliteItems(store: ItemStore | null) {
  const [items, setItems] = useState<Item[]>([]);
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    const next = store ? await store.list() : [];
    if (request === sequence.current) setItems(next);
  }, [store]);
  useEffect(() => {
    const refresh = () => { void reload().catch(error => console.warn("Could not reload items", error)); };
    refresh();
    const unsubscribe = store?.subscribe?.(refresh);
    return () => { sequence.current += 1; unsubscribe?.(); };
  }, [store, reload]);
  return { items, reload };
}
