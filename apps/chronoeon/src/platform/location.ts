import type { Locale } from "../domain/entry";
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

export interface LocatedPlace extends Coordinates {
  /** Short label for the entry's location field, e.g. 甘肃西和 / Beijing Haidian. */
  label: string;
}

const GEO_TIMEOUT_MS = 12_000;

/** Ask the device for one position; a refusal or timeout is a normal outcome. */
export async function requestCoordinates(timeoutMs = GEO_TIMEOUT_MS): Promise<Coordinates | null> {
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

/**
 * Read the device position and describe it. Returns null when permission is
 * refused or the lookup fails; callers surface that as a quiet notice rather
 * than inventing a location.
 */
export async function readCurrentPlace(locale: Locale): Promise<LocatedPlace | null> {
  const coordinates = await requestCoordinates();
  if (!coordinates) return null;
  const place = await reverseGeocode(coordinates, locale);
  const label = place ? formatPlaceLabel(place, locale) : "";
  return label ? { ...coordinates, label } : null;
}
