import { useMemo } from "react";
import type { Entry } from "../domain/entry";
import type { PhotoDisplayMode } from "@chronoeon/domain";
import { isDisplayableAttachment } from "../platform/attachments";
import { useAttachmentUrls } from "./useAttachmentUrls";

/** One record's photos on one civil day, with the annotations they carry. */
export interface DayPhotoGroup {
  id: string;
  /** The record itself: title, kind, category, location and note all live here. */
  entry: Entry;
  /** Displayable URLs, in the record's own order. */
  urls: string[];
}

/** Every stored photo a record carries, de-duplicated and displayable. */
function displayableImages(entry: Entry): string[] {
  return [...new Set((entry.images ?? []).filter((image) => Boolean(image) && isDisplayableAttachment(image)))];
}

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
  const references = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!enabled) return map;
    for (const [date, entries] of Object.entries(entriesByDate)) {
      const images: string[] = [];
      for (const entry of entries) {
        for (const image of displayableImages(entry)) if (!images.includes(image)) images.push(image);
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

  const resolved = useAttachmentUrls(useMemo(() => [...new Set(Object.values(references).flat())], [references]));

  return useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const [date, list] of Object.entries(references)) {
      const urls = list.map((reference) => resolved[reference]).filter((url): url is string => Boolean(url));
      if (urls.length) map[date] = urls;
    }
    return map;
  }, [references, resolved]);
}

/**
 * The photo wall's own view of the visible days: one group per record that
 * carries photos, so a record's several photos stay together and each frame
 * can be annotated with the title, category, location and note it belongs to.
 */
export function useDayPhotoGroups(
  entriesByDate: Record<string, Entry[]>,
  enabled = true,
): Record<string, DayPhotoGroup[]> {
  const groups = useMemo(() => {
    const map: Record<string, DayPhotoGroup[]> = {};
    if (!enabled) return map;
    for (const [date, entries] of Object.entries(entriesByDate)) {
      const dayGroups: DayPhotoGroup[] = [];
      for (const entry of entries) {
        const urls = displayableImages(entry);
        if (!urls.length) continue;
        dayGroups.push({
          id: entry.id,
          entry,
          urls,
        });
      }
      if (dayGroups.length) map[date] = dayGroups;
    }
    return map;
  }, [enabled, entriesByDate]);

  const references = useMemo(
    () => [...new Set(Object.values(groups).flatMap((day) => day.flatMap((group) => group.urls)))],
    [groups],
  );
  const resolved = useAttachmentUrls(references);

  return useMemo(() => {
    const map: Record<string, DayPhotoGroup[]> = {};
    for (const [date, day] of Object.entries(groups)) {
      const visible = day
        .map((group) => ({
          ...group,
          urls: group.urls.map((reference) => resolved[reference]).filter((url): url is string => Boolean(url)),
        }))
        .filter((group) => group.urls.length);
      if (visible.length) map[date] = visible;
    }
    return map;
  }, [groups, resolved]);
}
