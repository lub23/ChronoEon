import { useEffect, useMemo, useRef, useState } from "react";
import type { Entry } from "../domain/entry";
import type { PhotoDisplayMode } from "@chronoeon/domain";
import { isDisplayableAttachment, resolveAttachmentUrl } from "../platform/attachments";

/**
 * Resolve the photos attached to each visible day into displayable URLs.
 *
 * Local attachment paths have to go through the validated native reader, so
 * this is inherently asynchronous and cached: a month grid can reference the
 * same photo from several entries, and re-reading it on every render would put
 * a file read in the paint path. Resolution is limited to the dates the caller
 * is actually showing, and results are memoised for the lifetime of the app.
 */
export function useDayPhotos(
  entriesByDate: Record<string, Entry[]>,
  enabled = true,
  mode: PhotoDisplayMode = "first",
): Record<string, string[]> {
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());

  const references = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!enabled) return map;
    for (const [date, entries] of Object.entries(entriesByDate)) {
      const images: string[] = [];
      for (const entry of entries) {
        for (const image of entry.images ?? []) {
          if (image && isDisplayableAttachment(image) && !images.includes(image)) images.push(image);
        }
      }
      if (!images.length) continue;
      if (mode === "first") {
        map[date] = images.slice(0, 1);
      } else if (mode === "stable-random") {
        let seed = 0;
        for (const character of `${date}:${images.join("|")}`) seed = (seed * 31 + character.charCodeAt(0)) | 0;
        map[date] = [images[Math.abs(seed) % images.length]];
      } else {
        map[date] = images.slice(0, 8);
      }
    }
    return map;
  }, [enabled, entriesByDate, mode]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const missing = [...new Set(Object.values(references).flat())]
      .filter((reference) => !(reference in resolved) && !pending.current.has(reference));
    if (!missing.length) return;
    missing.forEach((reference) => pending.current.add(reference));
    void Promise.all(missing.map(async (reference) => {
      const url = await resolveAttachmentUrl(reference).catch(() => null);
      return [reference, url] as const;
    })).then((pairs) => {
      pairs.forEach(([reference]) => pending.current.delete(reference));
      if (disposed) return;
      setResolved((current) => {
        const next = { ...current };
        // Unreadable references are cached as an empty string so a missing file
        // is not retried on every re-render.
        for (const [reference, url] of pairs) next[reference] = url ?? "";
        return next;
      });
    });
    return () => {
      disposed = true;
      // React StrictMode deliberately runs an effect setup/cleanup/setup cycle.
      // Releasing this attempt lets the second setup retry instead of seeing a
      // permanently "pending" URL whose first result was correctly discarded.
      missing.forEach((reference) => pending.current.delete(reference));
    };
  }, [enabled, mode, references, resolved]);

  return useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const [date, list] of Object.entries(references)) {
      const urls = list.map((reference) => resolved[reference]).filter((url): url is string => Boolean(url));
      if (urls.length) map[date] = urls;
    }
    return map;
  }, [references, resolved]);
}
