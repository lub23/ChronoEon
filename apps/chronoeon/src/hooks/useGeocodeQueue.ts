import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GEO_LEVEL_DEVICE, GEO_LEVEL_MANUAL, GEO_PRECISE_SCORE, normalizeAddress, type Entry, type GeoPlace, type GeoPoint, type Item } from "@chronoeon/domain";
import type { GeocodeRow, GeocodeStore } from "@chronoeon/storage";
import { isTauri } from "../platform/desktop";
import { geocodeAddress, geocodeConfigured, geocodeSpacingMs, type GeocodeConfig } from "../platform/geocode";

/** Addresses without coordinates are asked again after a month. */
const RETRY_AFTER_MS = 30 * 86_400_000;
/** A transport failure parks the address for the session's next ten minutes. */
const FAILURE_BACKOFF_MS = 10 * 60_000;

export interface GeocodeQueue {
  places: Map<string, GeoPlace>;
  /** Places trusted enough to reuse for a device fix, in arbitrary order. */
  precise: GeoPlace[];
  loaded: boolean;
  pending: number;
  busy: boolean;
  /** Refresh saved fixes after applying a remote sync or another window's writes. */
  reload: () => Promise<void>;
  /** Keep the coordinates but take the address off the map. */
  exclude: (address: string) => Promise<void>;
  /** Forget the cached answer so the next tick asks the geocoder again. */
  retry: (address: string) => Promise<void>;
  /** Store a known point for an address without asking the geocoder. */
  cache: (address: string, point: GeoPoint, level?: string, score?: number) => Promise<void>;
}

/**
 * Background geocoder for every stored location. The synchronized SQLite table is the only
 * state; this hook just finds addresses the cache does not know and asks for
 * them one at a time, spaced for the configured service's free rate limit, as
 * records change.
 */
export function useGeocodeQueue(store: GeocodeStore | null, entries: readonly Entry[], items: readonly Item[], config: GeocodeConfig): GeocodeQueue {
  const [rows, setRows] = useState<Map<string, GeocodeRow>>(() => new Map());
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const failures = useRef(new Map<string, number>());
  const lastRequest = useRef(0);
  const edits = useRef(new Map<string, number>());
  const configured = geocodeConfigured(config);
  const spacing = geocodeSpacingMs(config.provider);
  const reload = useCallback(async () => {
    if (!store) return;
    const list = await store.all();
    // A remote/manual fix supersedes any lookup still waiting on the network.
    for (const key of new Set([...edits.current.keys(), ...list.map(row => row.address)])) edits.current.set(key, (edits.current.get(key) ?? 0) + 1);
    failures.current.clear();
    setRows(new Map(list.map(row => [row.address, row])));
    setLoaded(true);
  }, [store]);

  useEffect(() => {
    if (!store) return;
    let active = true;
    void store.all().then((list) => {
      if (!active) return;
      setRows(new Map(list.map((row) => [row.address, row])));
      setLoaded(true);
    }).catch((error) => console.warn("Could not read the geocode cache", error));
    return () => { active = false; };
  }, [store]);

  const missing = useMemo(() => {
    if (!loaded) return [] as string[];
    const now = Date.now();
    const seen = new Set<string>();
    const result: string[] = [];
    const consider = (location?: string) => {
      const address = location ? normalizeAddress(location) : "";
      if (!address || seen.has(address)) return;
      seen.add(address);
      const row = rows.get(address);
      if (row && (row.lng !== null || (row.score !== null && row.score < 0) || now - Date.parse(row.updatedAt) < RETRY_AFTER_MS)) return;
      if ((failures.current.get(address) ?? 0) > now - FAILURE_BACKOFF_MS) return;
      result.push(address);
    };
    for (const entry of entries) consider(entry.location);
    for (const item of items) consider(item.location);
    return result;
  }, [entries, items, rows, loaded]);

  useEffect(() => {
    if (!store || !configured || !missing.length || !isTauri()) { setBusy(false); return; }
    let cancelled = false;
    const wait = Math.max(0, lastRequest.current + spacing - Date.now());
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      const address = missing[0];
      const revision = edits.current.get(address) ?? 0;
      lastRequest.current = Date.now();
      setBusy(true);
      try {
        const result = await geocodeAddress(config, address);
        if (!result || cancelled || revision !== (edits.current.get(address) ?? 0)) return;
        const row: GeocodeRow = { address, lng: result.ok ? result.lng : null, lat: result.ok ? result.lat : null, score: result.score, level: result.level, updatedAt: new Date().toISOString() };
        const saved = await store.put(row, rows.get(address)?.updatedAt ?? null);
        if (!cancelled) {
          if (saved) setRows((current) => new Map(current).set(address, row));
          else await reload();
        }
      } catch (error) {
        console.warn("Geocoding failed", address, error);
        failures.current.set(address, Date.now());
        if (!cancelled) setRows((current) => new Map(current));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, wait);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [configured, config, missing, spacing, store, reload, rows]);

  const places = useMemo(() => {
    const result = new Map<string, GeoPlace>();
    for (const row of rows.values()) {
      if (row.lng === null || row.lat === null) continue;
      result.set(row.address, { address: row.address, lng: row.lng, lat: row.lat, score: row.score, level: row.level });
    }
    return result;
  }, [rows]);

  const precise = useMemo(
    () => [...places.values()].filter((place) => (place.score ?? 0) >= GEO_PRECISE_SCORE || place.level === GEO_LEVEL_DEVICE || place.level === GEO_LEVEL_MANUAL),
    [places],
  );

  const cache = useCallback(async (address: string, point: GeoPoint, level = GEO_LEVEL_DEVICE, score = 90) => {
    if (!store) return;
    const key = normalizeAddress(address);
    if (!key || !Number.isFinite(point.lng) || !Number.isFinite(point.lat) || Math.abs(point.lng) > 180 || Math.abs(point.lat) > 90) throw new Error("Invalid place coordinates");
    edits.current.set(key, (edits.current.get(key) ?? 0) + 1);
    const row: GeocodeRow = { address: key, lng: point.lng, lat: point.lat, score, level, updatedAt: new Date().toISOString() };
    await store.put(row);
    setRows((previous) => new Map(previous).set(key, row));
  }, [store]);

  const exclude = useCallback(async (address: string) => {
    if (!store) return;
    const key = normalizeAddress(address);
    edits.current.set(key, (edits.current.get(key) ?? 0) + 1);
    const current = rows.get(key);
    const row: GeocodeRow = { address: key, lng: current?.lng ?? null, lat: current?.lat ?? null, score: -1, level: current?.level ?? null, updatedAt: new Date().toISOString() };
    await store.put(row);
    setRows((previous) => new Map(previous).set(key, row));
  }, [rows, store]);

  const retry = useCallback(async (address: string) => {
    if (!store) return;
    const key = normalizeAddress(address);
    edits.current.set(key, (edits.current.get(key) ?? 0) + 1);
    await store.remove(key);
    failures.current.delete(key);
    setRows((previous) => { const next = new Map(previous); next.delete(key); return next; });
  }, [store]);

  return { places, precise, loaded, pending: configured ? missing.length : 0, busy, reload, exclude, retry, cache };
}
