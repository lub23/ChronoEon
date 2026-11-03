import { geocodeConfigured, reverseGeocodePlaces, type GeocodeConfig } from "./geocode";
import type { Locale } from "../domain/entry";
import { nearestPlaces, type GeoPlace } from "@chronoeon/domain";
import { isAndroidTauri, isTauri } from "./desktop";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Administrative names around one coordinate pair. */
export interface ReversePlace {
  province: string;
  city: string;
  locality: string;
  country: string;
  /** System geocoder detail; no coordinates masquerading as an address. */
  address?: string;
  neighborhood?: string;
  street?: string;
  name?: string;
}

const GEO_TIMEOUT_MS = 12_000;

/** Ask the device for one position; a refusal or timeout is a normal outcome. */
let coordinateRequest: Promise<Coordinates | null> | null = null;
export function requestCoordinates(timeoutMs = GEO_TIMEOUT_MS): Promise<Coordinates | null> {
  coordinateRequest ??= readCoordinates(timeoutMs).finally(() => { coordinateRequest = null; });
  return coordinateRequest;
}

async function readCoordinates(timeoutMs: number): Promise<Coordinates | null> {
  // Native Android LocationManager + AndroidX: no WebView permission path and
  // no dependency on Google Play Services. Native code bounds and cancels it.
  if (isAndroidTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const coordinates = await invoke<Coordinates>("device_location", { timeoutMs });
      return validCoordinates(coordinates);
    } catch { return null; }
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    const finish = (coordinates: Coordinates | null) => { window.clearTimeout(timer); resolve(coordinates); };
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => finish(validCoordinates(position.coords)),
        () => finish(null),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
      );
    } catch { finish(null); }
  });
}

function validCoordinates({ latitude, longitude }: Coordinates): Coordinates | null {
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null;
}

/** Reverse-geocode through the native shell, or directly in the browser demo. */
export async function reverseGeocode(coordinates: Coordinates, locale: Locale): Promise<ReversePlace | null> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ReversePlace>(isAndroidTauri() ? "device_reverse_geocode" : "reverse_geocode", {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      language: locale,
    }).catch(() => null);
  }
  const endpoint = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}&localityLanguage=${locale === "zh" ? "zh-Hans" : "en"}`;
  try {
    const response = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const payload = await response.json() as Record<string, unknown>;
    const field = (key: string) => typeof payload[key] === "string" ? (payload[key] as string).trim() : "";
    return {
      province: field("principalSubdivision"),
      city: field("city"),
      locality: field("locality"),
      country: field("countryName"),
    };
  } catch {
    return null;
  }
}

/** Preserve the street/POI when the system supplies one. Otherwise show all
 * available administrative levels without duplicating municipality names. */
export function formatPlaceLabel(place: ReversePlace, locale: Locale): string {
  const address = place.address?.trim();
  if (address) return address;
  const parts = [place.province, place.city, place.locality, place.neighborhood, place.street, place.name]
    .map(value => value?.trim()).filter((value): value is string => Boolean(value));
  const unique = parts.filter((value, index) => !parts.slice(0, index).includes(value));
  if (!unique.length) return place.country.trim();
  return locale === "zh" ? unique.join("") : unique.reverse().join(", ");
}

/** A device fix resolved to an address, preferring a place the user already uses. */
export interface NearbyPlace extends Coordinates {
  label: string;
  /** Alternatives for a chooser: nearby known places, or coarser readings of the fix. */
  candidates: string[];
  /** True when the label is one of the user's own cached places, so nothing new needs storing. */
  fromHistory: boolean;
  candidatePlaces?: GeoPlace[];
}

/**
 * Read the device position and name it. A cached place within walking
 * distance wins, so the same spot keeps the same spelling and the geocoder is
 * never asked twice; otherwise the system reverse-geocoder describes the fix.
 */
export async function readNearbyPlace(locale: Locale, places: Iterable<GeoPlace>, lookupNames = false, config?: GeocodeConfig): Promise<NearbyPlace | null> {
  const coordinates = await requestCoordinates();
  if (!coordinates) return null;
  const known = nearestPlaces({ lng: coordinates.longitude, lat: coordinates.latitude }, places);
  if (known.length && !lookupNames) return { ...coordinates, label: known[0].place.address, candidates: known.map((hit) => hit.place.address), fromHistory: true };
  if (lookupNames && config?.provider === "amap" && geocodeConfigured(config)) {
    const nearby = await reverseGeocodePlaces(config, { lng: coordinates.longitude, lat: coordinates.latitude });
    const candidatePlaces = [...known.map(hit => hit.place), ...nearby.filter(place => !known.some(hit => hit.place.address === place.address))];
    if (!candidatePlaces.length) return null;
    return { ...coordinates, label: candidatePlaces[0].address, candidates: candidatePlaces.map(place => place.address), candidatePlaces, fromHistory: known.length > 0 };
  }
  const place = await reverseGeocode(coordinates, locale);
  if (!place) return null;
  const label = formatPlaceLabel(place, locale);
  if (!label) return null;
  const join = (parts: Array<string | undefined>) => {
    const clean = parts.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
    const unique = clean.filter((value, index) => !clean.slice(0, index).includes(value));
    return locale === "zh" ? unique.join("") : unique.reverse().join(", ");
  };
  const candidates = [...new Set([...known.map(hit => hit.place.address), label, join([place.province, place.city, place.locality, place.name]), join([place.province, place.city, place.locality])].filter(Boolean))];
  return { ...coordinates, label: known[0]?.place.address ?? label, candidates, fromHistory: known.length > 0 };
}

/** Resolve an edited coordinate pair without acquiring the current device location. */
export async function placeNameCandidates(point: { lng: number; lat: number }, locale: Locale, config?: GeocodeConfig): Promise<string[]> {
  if (config?.provider === "amap" && geocodeConfigured(config)) return (await reverseGeocodePlaces(config, point)).map(place => place.address);
  const place = await reverseGeocode({ longitude: point.lng, latitude: point.lat }, locale);
  return place ? [formatPlaceLabel(place, locale)].filter(Boolean) : [];
}
