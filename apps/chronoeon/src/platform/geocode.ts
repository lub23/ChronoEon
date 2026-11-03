import { amapLevelScore, gcj02ToWgs84, wgs84ToGcj02, haversineKm, type GeoPoint, type GeoPlace, GEOCODE_ENDPOINTS, type GeocodeProvider } from "@chronoeon/domain";
import { isTauri } from "./desktop";

export interface GeocodeLookup {
  ok: boolean;
  lng: number | null;
  lat: number | null;
  score: number | null;
  level: string | null;
  message: string | null;
}

/** Which service to call and the device-local credentials it needs. */
export interface GeocodeConfig {
  provider: GeocodeProvider;
  /** Empty means the provider's default endpoint. */
  endpoint: string;
  /** apihz.cn user id; Amap has none. */
  id: string;
  key: string;
}

export function geocodeConfigured(config: GeocodeConfig): boolean {
  return config.provider === "amap" ? Boolean(config.key.trim()) : Boolean(config.id.trim() && config.key.trim());
}

/** Conservative request spacing; actual Amap quotas are account-specific. */
export function geocodeSpacingMs(provider: GeocodeProvider): number {
  return provider === "amap" ? 400 : 3200;
}

const numberOf = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const textOf = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const validPoint = (lng: number | null, lat: number | null) => lng !== null && lat !== null && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
const MISS: GeocodeLookup = { ok: false, lng: null, lat: null, score: null, level: null, message: null };

/**
 * Normalize one provider's answer to WGS84 plus a 0–100 confidence. apihz
 * already reports both; Amap answers in GCJ-02 with a feature level instead of
 * a score, so its coordinates are converted and the level graded.
 */
export function parseGeocodeResponse(provider: GeocodeProvider, payload: unknown): GeocodeLookup {
  if (!payload || typeof payload !== "object") return MISS;
  const data = payload as Record<string, unknown>;
  if (provider === "amap") {
    const hit = Array.isArray(data.geocodes) ? data.geocodes[0] as Record<string, unknown> | undefined : undefined;
    const [lngText, latText] = (textOf(hit?.location) ?? "").split(",");
    const lng = numberOf(lngText), lat = numberOf(latText);
    if (textOf(data.status) !== "1" || !hit || !validPoint(lng, lat)) return { ...MISS, message: textOf(data.info) };
    const level = textOf(hit.level);
    const point = gcj02ToWgs84({ lng: lng!, lat: lat! });
    return { ok: true, lng: point.lng, lat: point.lat, score: amapLevelScore(level), level, message: null };
  }
  if (numberOf(data.code) !== 200) return { ...MISS, message: textOf(data.msg) };
  const lng = numberOf(data.lng), lat = numberOf(data.lat);
  const score = numberOf(data.score);
  if (!validPoint(lng, lat)) return { ok: false, lng: null, lat: null, score: score === null ? null : Math.round(score), level: textOf(data.level), message: textOf(data.msg) };
  return { ok: true, lng, lat, score: score === null ? null : Math.round(score), level: textOf(data.level), message: null };
}

let requestTail = Promise.resolve();
const lastLookup = new Map<string, number>();

/** One budget for background lookups, refresh buttons and reverse queries. */
async function geocodeRequest(config: GeocodeConfig, address: string, point?: GeoPoint): Promise<unknown> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const previous = requestTail;
  let release!: () => void;
  requestTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    const service = `${config.provider}:${config.key}`;
    const wait = Math.max(0, (lastLookup.get(service) ?? 0) + geocodeSpacingMs(config.provider) - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastLookup.set(service, Date.now());
    const converted = point ? wgs84ToGcj02(point) : null;
    return await invoke<unknown>("geocode_address", {
      provider: config.provider,
      endpoint: point ? "https://restapi.amap.com/v3/geocode/regeo" : config.endpoint.trim() || GEOCODE_ENDPOINTS[config.provider],
      id: config.id, key: config.key, address, reversePoint: converted ? [converted.lng, converted.lat] : null,
    });
  } finally { release(); }
}

export async function geocodeAddress(config: GeocodeConfig, address: string): Promise<GeocodeLookup | null> {
  const payload = await geocodeRequest(config, address);
  return payload ? parseGeocodeResponse(config.provider, payload) : null;
}

/** Nearby POIs keep their own coordinates; a district label is never a shop. */
export function parseNearbyPlaces(payload: unknown, point: GeoPoint): GeoPlace[] {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as { status?: string; regeocode?: { pois?: Array<{ name?: unknown; location?: unknown }> } };
  if (data.status !== "1" || !Array.isArray(data.regeocode?.pois)) return [];
  const places = new Map<string, GeoPlace>();
  for (const poi of data.regeocode.pois) {
    const address = textOf(poi.name);
    const [lngText, latText] = (textOf(poi.location) ?? "").split(",");
    const lng = numberOf(lngText), lat = numberOf(latText);
    if (!address || !validPoint(lng, lat)) continue;
    const coordinates = gcj02ToWgs84({ lng: lng!, lat: lat! });
    const previous = places.get(address);
    if (haversineKm(point, coordinates) <= 0.25 && (!previous || haversineKm(point, coordinates) < haversineKm(point, previous))) places.set(address, { address, ...coordinates, level: "兴趣点", score: 90 });
  }
  return [...places.values()].sort((a, b) => haversineKm(point, a) - haversineKm(point, b)).slice(0, 5);
}

export async function reverseGeocodePlaces(config: GeocodeConfig, point: GeoPoint): Promise<GeoPlace[]> {
  return parseNearbyPlaces(await geocodeRequest(config, "", point), point);
}
