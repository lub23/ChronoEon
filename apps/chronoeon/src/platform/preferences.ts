import { isTauri } from "./desktop";
import { createSqliteStoreSession } from "./sqliteSession";

let nativePreferences: import("@chronoeon/storage").LocalPreferences | null = null;
let nativeValues: Record<string, string> | null = null;

/** Hydrate before mounting React: every native origin reads the same settings. */
export async function hydrateNativePreferences(): Promise<void> {
  if (!isTauri()) return;
  const session = await createSqliteStoreSession();
  if (!session) return;
  nativePreferences = session.preferences;
  nativeValues = await nativePreferences.readAll();
}
export function readPreferenceValue(key: string): string | null {
  return nativeValues ? nativeValues[key] ?? null : window.localStorage.getItem(key);
}
export function persistPreference(key: string, value: string): void {
  if (!isTauri()) { window.localStorage.setItem(key, value); return; }
  if (nativeValues) nativeValues[key] = value;
  const save = nativePreferences ? nativePreferences.set(key, value) : Promise.reject(new Error("Native preferences are not initialized"));
  void save
    .catch(error => { console.error("Could not save local preference", error); window.dispatchEvent(new Event("chronoeon:preference-error")); });
}
