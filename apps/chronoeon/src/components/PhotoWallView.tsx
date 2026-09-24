import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { entriesForDate } from "@chronoeon/domain";
import type { Entry, ChronoEonSettings, Locale } from "../domain/entry";
import { useDayPhotoGroups } from "../hooks/useDayPhotos";
import { PhotoWall } from "./PhotoWall";

/** One page of days grown at either end while the reader keeps scrolling. */
const PHOTO_PAGE_DAYS = 14;
/** A paged wall opens on the list view's own initial window. */
const INITIAL_BEFORE_DAYS = 28;
const INITIAL_AFTER_DAYS = 56;

/** The civil days a photo wall covers, starting at the selected date. */
export function photoWallDays(selectedDate: Date, count: number): string[] {
  return Array.from({ length: Math.max(1, Math.round(count)) }, (_, index) => format(addDays(selectedDate, index), "yyyy-MM-dd"));
}

interface PhotoWallViewProps {
  entries: Entry[];
  selectedDate: Date;
  /** How many civil days from the selection a fixed wall shows. */
  days: number;
  locale: Locale;
  settings: ChronoEonSettings;
  /** Grow the window as the reader scrolls, like the list's own timeline. */
  paged?: boolean;
  onSelectDate?: (date: Date) => void;
}

/**
 * Photo appreciation as a view of its own, so every list-like surface can use
 * the same wall instead of each growing its own photo branch. Paged mode keeps
 * the window bounded while still letting a reader walk the whole archive.
 */
export function PhotoWallView({ entries, selectedDate, days, locale, settings, paged = false, onSelectDate }: PhotoWallViewProps) {
  const [before, setBefore] = useState(INITIAL_BEFORE_DAYS);
  const [after, setAfter] = useState(INITIAL_AFTER_DAYS);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const dayKeys = useMemo(() => {
    if (!paged) return photoWallDays(selectedDate, days);
    return Array.from({ length: before + after }, (_, index) =>
      format(addDays(selectedDate, index - before), "yyyy-MM-dd"));
    // A new selection re-opens on the initial window rather than keeping the
    // previous scroll's range.
  }, [paged, selectedDate, days, before, after]);

  useEffect(() => {
    if (!paged) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.target === topRef.current) setBefore((current) => current + PHOTO_PAGE_DAYS);
        if (entry.target === bottomRef.current) setAfter((current) => current + PHOTO_PAGE_DAYS);
      }
    }, { rootMargin: "400px" });
    if (topRef.current) observer.observe(topRef.current);
    if (bottomRef.current) observer.observe(bottomRef.current);
    return () => observer.disconnect();
  }, [paged, before, after]);

  const entriesByDate = useMemo(
    () => Object.fromEntries(dayKeys.map((key) => [key, entriesForDate(entries, key)])),
    [dayKeys, entries],
  );
  const groups = useDayPhotoGroups(entriesByDate, true);

  return (
    <section className="day-view panel day-view--photos">
      {paged && <div ref={topRef} className="photo-wall-sentinel" aria-hidden="true" />}
      <PhotoWall
        locale={locale}
        settings={settings}
        days={dayKeys}
        groups={groups}
        onSelectDate={onSelectDate ? (key) => onSelectDate(new Date(`${key}T00:00:00`)) : undefined}
      />
      {paged && <div ref={bottomRef} className="photo-wall-sentinel" aria-hidden="true" />}
    </section>
  );
}
