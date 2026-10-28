import { persistPreference, readPreferenceValue } from "../platform/preferences";
import { useEffect, useState } from "react";

const PREFERENCE_PREFIX = "chronoeon.preference";

export function usePersistentPreference<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const currentKey = `${PREFERENCE_PREFIX}.${key}`;
      const raw = readPreferenceValue(currentKey);
      return raw ? JSON.parse(raw) as T : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      persistPreference(`${PREFERENCE_PREFIX}.${key}`, JSON.stringify(value));
    } catch {
      // Display preferences are optional; storage denial must not unmount the app.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
