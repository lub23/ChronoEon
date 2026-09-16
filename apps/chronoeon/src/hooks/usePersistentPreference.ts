import { useEffect, useState } from "react";

const PREFERENCE_PREFIX = "chronoeon.preference";
const LEGACY_PREFERENCE_PREFIX = "chronicle.preference";

export function usePersistentPreference<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const currentKey = `${PREFERENCE_PREFIX}.${key}`;
      const legacyKey = `${LEGACY_PREFERENCE_PREFIX}.${key}`;
      const raw = window.localStorage.getItem(currentKey) ?? window.localStorage.getItem(legacyKey);
      return raw ? JSON.parse(raw) as T : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(`${PREFERENCE_PREFIX}.${key}`, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}
