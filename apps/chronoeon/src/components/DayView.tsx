import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import {
  applyCalendarDrag,
  addIsoDays,
  classifyCrossDayEntry,
  convertCalendarEntryToAllDay,
  convertCalendarEntryToTimed,
  dayExpenseTotal,
  differenceInIsoDays,
  entriesForDate,
  entrySegmentForDate,
  formatClockMinutes,
  layoutOverlappingEntries,
  timedItemMinHeightPx,
  type CalendarSchedulePatch,
  type OverlapPlacement,
} from "@chronoeon/domain";
import type { ChronoEonSettings, Entry, EntryDraft, EntryKind, Locale } from "../domain/entry";
import { kindAllowed, type AgendaFilter } from "../domain/agendaTimeline";
import { layoutSpanLane } from "../domain/monthLayout";
import { lunarCellLabel, lunarDescription, shouldShowLunar, type LunarPreference } from "../domain/lunar";
import { entryMatchesSearch } from "../domain/search";
import { useDayPhotos } from "../hooks/useDayPhotos";
import { t } from "../i18n";
import { DayPhotoBackground } from "./DayPhotoBackground";
import { ExpenseBox } from "./ExpenseBox";
import { Icon } from "./Icon";
import { ItemChip } from "./ItemChip";
import { MonthDayPeek } from "./MonthDayPeek";
import { PhotoWallView } from "./PhotoWallView";
import { clearChipDrag, markChipDragActive } from "./dragGesture";

interface DayViewProps {
  entries: Entry[];
  selectedDate: Date;
  locale: Locale;
  settings: ChronoEonSettings;
  /** How many civil-day columns to draw: 1-6 for Day, exactly 7 for Week. */
  days: number;
  /** Week anchors the first column to the week start; Day starts on the selection. */
  anchor: "selection" | "week";
  filter: AgendaFilter;
  search: string;
  weekStartsOn?: ChronoEonSettings["firstDay"];
  timeScale?: ChronoEonSettings["timeScale"];
  lunar?: LunarPreference;
  showPhotos?: boolean;
  /** Photo appreciation: hide every chip and show the visible days' photos. */
  photosOnly?: boolean;
  onSelectDate: (date: Date) => void;
  /** Available only for the flexible Day view; Week stays fixed at seven. */
  onToggle: (id: string, entry?: Entry) => void;
  onEdit: (entry: Entry) => void;
  onNew: () => void;
  onNewAt?: (draft: Partial<EntryDraft>) => void;
  onReschedule: (entry: Entry, patch: CalendarSchedulePatch) => void | Promise<void>;
  onEntryMenu?: (entry: Entry, event: React.MouseEvent) => void;
}

type DragEdge = "move" | "resize-start" | "resize-end";
interface DragVisual {
  key: string;
  /** The schedule the drop will produce — the ghost is rendered exactly here. */
  patch: CalendarSchedulePatch;
  /** The entry being dragged; the ghost re-uses its colors, kind and duration. */
  entry: Entry;
  /**
   * Snapped resize delta in minutes relative to the pointer origin. Drives the
   * moving chip's in-place resize-edge stretch (negative = growing up). A
   * *move* never transforms the chip; the board-level ghost previews the
   * landing slot instead.
   */
  deltaMinutes: number;
  edge: DragEdge;
  mode: "schedule" | "to-all-day" | "to-timed";
  moved: boolean;
  sourceDate: string;
}

interface TimeSelectionVisual {
  startDate: string;
  endDate: string;
  start: string;
  end: string;
  segments: Array<{ date: string; startMinutes: number; endMinutes: number }>;
}

/** A vertical overflow indicator + peek for a collision group whose items
    are too narrow to read. Mirrors the MonthView "+N" badge but oriented
    vertically: up to 3 dots stacked, and a click opens a popover listing
    every entry in the group. */
interface TimedOverflowPeek {
  dateKey: string;
  date: Date;
  anchor: DOMRect;
  entries: Entry[];
}

const DEFAULT_HOUR_HEIGHT = 56;
const TIME_GUTTER = 28;
/** Vertical pitch of one all-day lane row: 17px chip plus room for photo air. */
const LANE_PITCH = 23;
/** Minimum pixel width a timed chip needs to show its time + glyph and a few
    title characters. Below this, items are progressively hidden and a
    vertical indicator takes their place. */
const MIN_TIMED_ITEM_WIDTH = 48;
/** Width of the vertical overflow indicator bar — just enough for a dot. */
const TIMED_OVERFLOW_BAR_WIDTH = 9;
/** Painted-height thresholds for the timed chip's one-line detail stack. */
const TIMED_TWO_LINE_MIN_PX = 33;
const TIMED_THREE_LINE_MIN_PX = 44;
const TIMED_FOUR_LINE_MIN_PX = 55;

function timedDetailLines(height: number): 1 | 2 | 3 | 4 {
  if (height >= TIMED_FOUR_LINE_MIN_PX) return 4;
  if (height >= TIMED_THREE_LINE_MIN_PX) return 3;
  if (height >= TIMED_TWO_LINE_MIN_PX) return 2;
  return 1;
}

function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * First visible column. Week pins the column to the configured week start (so
 * navigating never re-anchors the grid mid-week); Day starts at the selection
 * and simply extends forward, which is what a "next N days" view should do.
 */
function displayStartFor(selectedDate: Date, anchor: "selection" | "week", weekStartsOn: ChronoEonSettings["firstDay"]): Date {
  return anchor === "week" ? startOfWeek(selectedDate, { weekStartsOn }) : selectedDate;
}

function minutesToTime(value: number): string {
  return formatClockMinutes(Math.max(0, Math.min(23 * 60 + 45, value)));
}

function placementKey(placement: OverlapPlacement): string {
  return `${placement.entry.id}:${placement.date}`;
}

function dragPreviewEntry(entry: Entry, patch: CalendarSchedulePatch): Entry | null {
  if (patch.allDay || !patch.start) return null;
  return {
    ...entry,
    id: `${entry.id}:drag-preview`,
    date: patch.date,
    start: patch.start,
    end: patch.end,
    endDate: patch.endDate,
    allDay: false,
  };
}

/**
 * Compose a short, bilingual live-region / drag-tooltip label describing what
 * the in-progress drag will do once released. The plugin's DragInfoTooltip does
 * the same ("2026-05-27 08:00 - 09:30" or "5月27日 至 5月28日"); surfacing it in
 * an `aria-live` region also makes the schedule change screen-reader friendly,
 * which was previously missing in the primary app.
 */
function announceFor(entry: Entry, visual: DragVisual, targetDate: string, inLane: boolean, locale: Locale): string {
  const dateText = locale === "zh"
    ? format(parseISO(targetDate), "M月d日")
    : format(parseISO(targetDate), "MMM d");
  if (visual.mode === "to-all-day") {
    return t("dragInfoConvertAllDay", locale).replace("{date}", dateText);
  }
  if (visual.mode === "to-timed") {
    const startMinutes = visual.patch.start ? timeMinutes(visual.patch.start) : 0;
    const timeText = formatClockMinutes(Math.max(0, Math.min(24 * 60, startMinutes)));
    return t("dragInfoConvertTimed", locale).replace("{date}", dateText).replace("{time}", timeText);
  }
  if (edgeIsResize(visual.edge) && !inLane && visual.patch.start) {
    const startText = formatClockMinutes(timeMinutes(visual.patch.start));
    const endMinutes = visual.patch.end ? timeMinutes(visual.patch.end) : null;
    const endDateText = visual.patch.endDate && visual.patch.endDate !== visual.patch.date
      ? ` ${t("dragInfoHintAllDay", locale)} ${locale === "zh" ? format(parseISO(visual.patch.endDate), "M月d日") : format(parseISO(visual.patch.endDate), "MMM d")}`
      : "";
    const endSuffix = endMinutes !== null ? ` – ${formatClockMinutes(endMinutes)}` : endDateText;
    return t("dragInfoResize", locale).replace("{start}", startText).replace("{endSuffix}", endSuffix);
  }
  if (inLane) {
    const endDateText = visual.patch.endDate && visual.patch.endDate !== visual.patch.date
      ? ` ${t("dragInfoHintAllDay", locale).toLowerCase()} ${locale === "zh" ? format(parseISO(visual.patch.endDate), "M月d日") : format(parseISO(visual.patch.endDate), "MMM d")}`
      : "";
    return `${t("dragInfoMoveAllDay", locale).replace("{date}", dateText)}${endDateText}`;
  }
  if (visual.patch.start) {
    const timeText = formatClockMinutes(Math.max(0, Math.min(24 * 60, timeMinutes(visual.patch.start))));
    return t("dragInfoMoveTimed", locale).replace("{date}", dateText).replace("{time}", timeText);
  }
  return t("dragInfoMoveAllDay", locale).replace("{date}", dateText);
}

function edgeIsResize(edge: DragEdge): edge is "resize-start" | "resize-end" {
  return edge === "resize-start" || edge === "resize-end";
}

function timeMinutes(clock: string): number {
  const [h, m] = clock.split(":").map((part) => Number(part) || 0);
  return h * 60 + m;
}

/** A previous day, or today's timed segment whose end is at/behind now. */
function isPastCalendarItem(entry: Entry, dayKey: string, todayKey: string, nowMinutes: number, endMinutes?: number): boolean {
  if (dayKey < todayKey) return true;
  if (dayKey > todayKey) return false;
  if (entry.allDay || !entry.start) return false;
  return typeof endMinutes === "number" ? endMinutes <= nowMinutes : false;
}

/** A span is past only when every visible day is complete. */
function isPastCalendarSpan(spanStartKey: string, spanDays: number, todayKey: string): boolean {
  return addIsoDays(spanStartKey, Math.max(0, spanDays - 1)) < todayKey;
}

export function DayView({
  entries,
  selectedDate,
  locale,
  settings,
  days,
  anchor,
  filter,
  search,
  weekStartsOn = 1,
  timeScale = 15,
  lunar = "auto",
  showPhotos = true,
  photosOnly = false,
  onSelectDate,
  onToggle,
  onEdit,
  onNew,
  onNewAt,
  onReschedule,
  onEntryMenu,
}: DayViewProps) {
  const calendarRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gestureCleanupRef = useRef<(() => void) | null>(null);
  const suppressOpenUntilRef = useRef(0);
  // A pending touch press that has NOT yet crossed the long-press gate. Until a
  // touch contact survives ~300 ms without moving > 8 px, we treat the gesture
  // as a potential tap/scroll rather than a drag. Cancelling here prevents drag from stealing
  // page scroll on touchpads / mobile.
  const pendingTouchRef = useRef<{ startX: number; startY: number; timer: number; cancel: () => void } | null>(null);
  const selectionCleanupRef = useRef<(() => void) | null>(null);
  const [viewport, setViewport] = useState({ width: 900, height: 650 });
  const [dragVisual, setDragVisual] = useState<DragVisual | null>(null);
  const [timeSelection, setTimeSelection] = useState<TimeSelectionVisual | null>(null);
  const [dragAnnounce, setDragAnnounce] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [timedPeek, setTimedPeek] = useState<TimedOverflowPeek | null>(null);

  useLayoutEffect(() => {
    const element = calendarRef.current;
    if (!element) return;
    let frame = 0;
    const run = () => {
      frame = 0;
      setViewport({ width: element.clientWidth || 900, height: element.clientHeight || 650 });
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(run);
    };
    // Initial measurement is synchronous so the first render has the right
    // column width / hour height; only subsequent resize callbacks are
    // rAF-throttled.
    run();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => gestureCleanupRef.current?.(), []);
  useEffect(() => () => selectionCleanupRef.current?.(), []);

  // Day always honours the chosen 1–6 columns and Week is exactly seven. On a
  // phone the shared board scrolls horizontally instead of silently changing
  // the requested civil-date range (which made navigation and drag targets lie).
  const visibleDays = Math.max(1, Math.min(anchor === "week" ? 7 : 6, Math.round(days) || 1));
  const rangeStart = useMemo(
    () => displayStartFor(selectedDate, anchor, weekStartsOn),
    [anchor, selectedDate, weekStartsOn],
  );
  const dayKeys = useMemo(
    () => Array.from({ length: visibleDays }, (_, index) => dateKey(addDays(rangeStart, index))),
    [rangeStart, visibleDays],
  );
  const { width: viewportWidth, height: viewportHeight } = viewport;
  const densityFactor: Record<ChronoEonSettings["timeScale"], number> = {
    10: 1.24,
    15: 1.14,
    20: 1.06,
    30: 1,
    60: 0.8,
  };
  const baseHourHeight = Math.max(44, Math.min(68, viewportHeight > 830 ? 64 : viewportHeight > 620 ? DEFAULT_HOUR_HEIGHT : 48));
  const hourHeight = Math.round(baseHourHeight * (densityFactor[timeScale] ?? 1));
  const pixelsPerMinute = hourHeight / 60;
  // How many side-by-side timed items fit readably in one day column. When a
  // collision group has more columns than this, the excess is hidden and a
  // vertical indicator bar takes its place — the same progressive-hiding the
  // Month grid does with "+N", but oriented vertically.
  const columnWidth = Math.max(1, (viewportWidth - TIME_GUTTER) / visibleDays);
  const maxVisibleColumns = Math.max(1, Math.floor(columnWidth / MIN_TIMED_ITEM_WIDTH));
  const showLunar = shouldShowLunar(lunar, locale) && visibleDays <= 4;
  // Close the timed overflow peek when anything that moves the grid invalidates
  // the anchor rect — the same pattern as the MonthView peek.
  useEffect(() => { setTimedPeek(null); }, [dayKeys, maxVisibleColumns]);
  useEffect(() => {
    if (!timedPeek) return;
    const close = () => setTimedPeek(null);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [timedPeek]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    // Open on the working day rather than at midnight, but keep the sticky
    // header in view so the columns still read as a calendar.
    scroller.scrollTop = Math.max(0, 7 * hourHeight);
  }, [hourHeight, rangeStart.getTime()]);

  const visibleFor = useMemo(() => (key: string) => entriesForDate(entries, key)
    .filter((entry) => kindAllowed(filter, entry.kind))
    .filter((entry) => entryMatchesSearch(entry, search, locale)), [entries, filter, locale, search]);

  const belongsInLane = (entry: Entry) => entry.allDay || !entry.start || classifyCrossDayEntry(entry) === "cross-day-long";
  const expenseByDate = useMemo(() => Object.fromEntries(
    dayKeys.map((key) => [key, dayExpenseTotal(entriesForDate(entries, key), settings)]),
  ), [dayKeys, entries, settings]);
  const dayData = useMemo(() => dayKeys.map((key) => {
    const visible = visibleFor(key);
    return {
      key,
      all: visible,
      // A day's spending is context, not a bill-filter result. Keeping the box
      // visible while filtering tasks/events is the explicit parity requirement.
      expense: expenseByDate[key] ?? 0,
      // Short cross-midnight ranges are split in the time grid; ranges longer
      // than 24 h park once in the all-day lane.
      timed: layoutOverlappingEntries(
        visible.filter((entry) => Boolean(entry.start) && !belongsInLane(entry)),
        key,
        pixelsPerMinute,
      ),
    };
 }), [dayKeys, expenseByDate, pixelsPerMinute, visibleFor]);

  // Group timed placements by collision groupId and determine which groups
  // have too many columns for the current column width. For each overflowing
  // group, the visible items are widened to fill 1/visibleColumnCount of the
  // column (instead of 1/fullColumnCount), and the hidden items are
  // represented by a vertical indicator bar.
  const timedOverflow = useMemo(() => {
    const result = new Map<string, Map<number, {
      visibleColumnCount: number;
      hiddenCount: number;
      topMinutes: number;
      bottomMinutes: number;
      entries: Entry[];
    }>>();
    for (const { key, timed } of dayData) {
      const groups = new Map<number, {
        columnCount: number;
        topMinutes: number;
        bottomMinutes: number;
        entries: Entry[];
      }>();
      for (const p of timed) {
        const g = groups.get(p.groupId) ?? { columnCount: 0, topMinutes: Infinity, bottomMinutes: 0, entries: [] };
        g.columnCount = Math.max(g.columnCount, p.columnCount);
        g.topMinutes = Math.min(g.topMinutes, p.startMinutes);
        g.bottomMinutes = Math.max(g.bottomMinutes, p.endMinutes);
        g.entries.push(p.entry);
        groups.set(p.groupId, g);
      }
      const overflow = new Map<number, {
        visibleColumnCount: number;
        hiddenCount: number;
        topMinutes: number;
        bottomMinutes: number;
        entries: Entry[];
      }>();
      for (const [groupId, g] of groups) {
        const visibleColumnCount = Math.min(g.columnCount, maxVisibleColumns);
        const hiddenCount = g.columnCount - visibleColumnCount;
        if (hiddenCount > 0) {
          overflow.set(groupId, {
            visibleColumnCount,
            hiddenCount,
            topMinutes: g.topMinutes,
            bottomMinutes: g.bottomMinutes,
            entries: g.entries,
          });
        }
      }
      if (overflow.size) result.set(key, overflow);
    }
    return result;
  }, [dayData, maxVisibleColumns]);

  const lane = useMemo(
    () => layoutSpanLane(
      dayKeys,
      (key) => visibleFor(key).filter(belongsInLane),
      (key) => (expenseByDate[key] ?? 0) > 0 ? 1 : 0,
    ),
    [dayKeys, expenseByDate, visibleFor],
  );

  const entriesByDate = useMemo(
    () => Object.fromEntries(dayKeys.map((key) => [key, entriesForDate(entries, key)])),
    [dayKeys, entries],
  );
  // The timeline layout never paints a photo backdrop; reading them would be
  // disk work per visible day for nothing. Photo appreciation reads its own,
  // annotated view of the same days below.
  const photos = useDayPhotos(entriesByDate, showPhotos && !photosOnly);

  function beginGesture(
    event: React.PointerEvent<HTMLElement>,
    entry: Entry,
    edge: DragEdge,
    key: string,
    inLane = false,
    sourceSegmentDate?: string,
  ) {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const originY = event.clientY;
    // Touch users must long-press before a drag starts; this stops
    // an immediate pointer move from stealing scroll. A mouse press enters the
    // gesture immediately.
    if (event.pointerType === "touch") {
      if (pendingTouchRef.current) {
        pendingTouchRef.current.cancel();
        pendingTouchRef.current = null;
      }
      const cancelPending = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", onPendingMove, true);
        window.removeEventListener("pointerup", onPendingUp, { capture: true } as EventListenerOptions);
        window.removeEventListener("touchmove", onPendingTouchMove, { capture: true, passive: false } as EventListenerOptions);
      };
      const onPendingMove = (moveEvent: PointerEvent) => {
        if (Math.abs(moveEvent.clientX - originX) > 8 || Math.abs(moveEvent.clientY - originY) > 8) {
          cancelPending();
          pendingTouchRef.current = null;
        }
      };
      const onPendingTouchMove = (moveEvent: TouchEvent) => {
        if (moveEvent.cancelable) moveEvent.preventDefault();
        if (Math.abs((moveEvent.touches[0]?.clientX ?? originX) - originX) > 8
          || Math.abs((moveEvent.touches[0]?.clientY ?? originY) - originY) > 8) {
          cancelPending();
          pendingTouchRef.current = null;
        }
      };
      const onPendingUp = () => cancelPending();
      const fire = () => {
        pendingTouchRef.current = null;
        enterGesture();
      };
      const timer = window.setTimeout(fire, 300);
      pendingTouchRef.current = { startX: originX, startY: originY, timer, cancel: cancelPending };
      window.addEventListener("pointermove", onPendingMove, true);
      window.addEventListener("pointerup", onPendingUp, { capture: true } as EventListenerOptions);
      window.addEventListener("touchmove", onPendingTouchMove, { capture: true, passive: false } as EventListenerOptions);
      return;
    }
    enterGesture();

    function enterGesture() {
      const columns = [...(calendarRef.current?.querySelectorAll<HTMLElement>(".calendar-day-column[data-date]") ?? [])];
      const allDayCells = [...(calendarRef.current?.querySelectorAll<HTMLElement>(".calendar-all-day-cell[data-date]") ?? [])];
      const dateAtX = (items: HTMLElement[], clientX: number): string | null => {
        const exact = items.find((item) => {
          const rect = item.getBoundingClientRect();
          return clientX >= rect.left && clientX <= rect.right;
        });
        return exact?.dataset.date ?? null;
      };
      const grabbedDate = sourceSegmentDate
        ?? dateAtX(inLane ? allDayCells : columns, originX)
        ?? entry.date;
      const columnsWidth = calendarRef.current?.querySelector<HTMLElement>(".calendar-columns")?.clientWidth
        ?? Math.max(1, viewportWidth - TIME_GUTTER);
      const columnWidth = Math.max(1, columnsWidth / visibleDays);
      let latest: DragVisual = {
        key,
        entry,
        patch: applyCalendarDrag(entry, { edge }),
        deltaMinutes: 0,
        edge,
        mode: "schedule",
        moved: false,
        sourceDate: grabbedDate,
      };
      setDragVisual(latest);
      setDragAnnounce(announceFor(entry, latest, grabbedDate, inLane, locale));
      markChipDragActive();

      const update = (moveEvent: PointerEvent) => {
        const allDayGrid = calendarRef.current?.querySelector<HTMLElement>(".calendar-all-day-grid");
        const allDayRect = allDayGrid?.getBoundingClientRect();
        const inAllDayTarget = Boolean(allDayRect
          && moveEvent.clientY >= allDayRect.top - 3
          && moveEvent.clientY <= allDayRect.bottom + 3);
        const allDayDate = inAllDayTarget ? dateAtX(allDayCells, moveEvent.clientX) : null;
        const timedDate = dateAtX(columns, moveEvent.clientX);

        if (edge === "move" && !inLane && entry.kind !== "bill" && allDayDate) {
          const patch = convertCalendarEntryToAllDay(entry, grabbedDate, allDayDate);
          latest = {
            key,
            entry,
            patch,
            deltaMinutes: 0,
            edge,
            mode: "to-all-day",
            moved: true,
            sourceDate: grabbedDate,
          };
          setDragVisual(latest);
          setDragAnnounce(announceFor(entry, latest, allDayDate, true, locale));
          return;
        }

        const timeCanvas = calendarRef.current?.querySelector<HTMLElement>(".calendar-grid-canvas");
        const timeRect = timeCanvas?.getBoundingClientRect();
        if (edge === "move" && inLane && entry.kind !== "bill" && timedDate && timeRect
          && moveEvent.clientY >= timeRect.top && moveEvent.clientY <= timeRect.bottom) {
          const rawMinutes = ((moveEvent.clientY - timeRect.top) / hourHeight) * 60;
          const targetMinutes = Math.round(rawMinutes / timeScale) * timeScale;
          latest = {
            key,
            entry,
            patch: convertCalendarEntryToTimed(timedDate, targetMinutes, Math.max(30, timeScale)),
            deltaMinutes: targetMinutes,
            edge,
            mode: "to-timed",
            moved: true,
            sourceDate: grabbedDate,
          };
          setDragVisual(latest);
          setDragAnnounce(announceFor(entry, latest, timedDate, false, locale));
          return;
        }

        const targetDate = timedDate ?? allDayDate;
        const pointerDays = targetDate
          ? differenceInIsoDays(targetDate, grabbedDate)
          : Math.round((moveEvent.clientX - originX) / columnWidth);
        const resizeBase = edge === "resize-end" ? (entry.endDate ?? entry.date) : entry.date;
        const deltaDays = targetDate && edge !== "move"
          ? differenceInIsoDays(targetDate, resizeBase)
          : pointerDays;
        // Clamp raw drag minutes to a single civil-day window before snapping,
        // so a downward resize inside one column snaps to 24:00 of that day
        // rather than freely spilling into the next civil day — the parity
        // behaviour of the plugin's clampAndSnapMinutes(min=0,max=1440).
        const rawMinutes = inLane ? 0 : ((moveEvent.clientY - originY) / hourHeight) * 60;
        const clamped = inLane ? 0 : Math.max(-24 * 60, Math.min(24 * 60, rawMinutes));
        const deltaMinutes = inLane ? 0 : Math.round(clamped / timeScale) * timeScale;
        const moved = deltaDays !== 0 || deltaMinutes !== 0;
        latest = {
          key,
          entry,
          patch: applyCalendarDrag(entry, { days: deltaDays, minutes: deltaMinutes, edge }),
          deltaMinutes,
          edge,
          mode: "schedule",
          moved,
          sourceDate: grabbedDate,
        };
        setDragVisual(latest);
        setDragAnnounce(announceFor(entry, latest, targetDate ?? grabbedDate, inLane, locale));
      };
      // Suppress page scroll while a drag is in progress for touch. passive: false
      // lets preventDefault take effect.
      const touchMoveGuard = (touchEvent: TouchEvent) => {
        if (touchEvent.cancelable) touchEvent.preventDefault();
      };
      function cleanup() {
        window.removeEventListener("pointermove", update);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("touchmove", touchMoveGuard, { capture: true, passive: false } as EventListenerOptions);
        if (gestureCleanupRef.current === cleanup) gestureCleanupRef.current = null;
      }
      function finish() {
        cleanup();
        clearChipDrag();
        setDragVisual(null);
        setDragAnnounce("");
        if (latest.moved) {
          suppressOpenUntilRef.current = Date.now() + 500;
          void onReschedule(entry, latest.patch);
        }
      }
      function cancel() {
        cleanup();
        clearChipDrag();
        setDragVisual(null);
        setDragAnnounce("");
      }
      gestureCleanupRef.current?.();
      gestureCleanupRef.current = cleanup;
      window.addEventListener("pointermove", update);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", cancel, { once: true });
      window.addEventListener("touchmove", touchMoveGuard, { capture: true, passive: false } as EventListenerOptions);
    }
  }

  function handleEmptyDoubleClick(event: React.MouseEvent<HTMLDivElement>, key: string) {
    if (!onNewAt) {
      onNew();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = Math.round(((event.clientY - rect.top) / hourHeight * 60) / timeScale) * timeScale;
    const boundedMinutes = Math.max(0, Math.min(23 * 60 + 45, minutes));
    const start = minutesToTime(boundedMinutes);
    const end = boundedMinutes + 30 < 24 * 60 ? minutesToTime(boundedMinutes + 30) : undefined;
    onNewAt({ date: key, start, end, allDay: false });
  }

  /**
   * Drag on empty hour-board space previews the exact range before the
   * composer opens. It reuses entry drag snapping, so the highlighted block
   * never promises a schedule the composer cannot represent.
   */
  function beginTimeSelection(event: React.PointerEvent<HTMLDivElement>, key: string) {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    if ((event.target as HTMLElement).closest(".item-chip, button")) return;
    const isTouch = event.pointerType === "touch";
    if (!isTouch) event.preventDefault();
    selectionCleanupRef.current?.();
    const pointerId = event.pointerId;

    const columns = [...(calendarRef.current?.querySelectorAll<HTMLElement>(".calendar-day-column[data-date]") ?? [])];
    const columnAtPoint = (clientX: number, clientY: number) => {
      const column = columns.find((item) => {
        const columnRect = item.getBoundingClientRect();
        return clientX >= columnRect.left && clientX <= columnRect.right;
      });
      if (!column) return null;
      const rect = column.getBoundingClientRect();
      const minutes = Math.round((((clientY - rect.top) / hourHeight) * 60) / timeScale) * timeScale;
      return {
        date: column.dataset.date ?? key,
        minutes: Math.max(0, Math.min(24 * 60, minutes)),
      };
    };
    const originX = event.clientX;
    const originY = event.clientY;
    const anchor = columnAtPoint(originX, originY) ?? { date: key, minutes: 0 };
    let selectionStarted = false;
    let touchTimer = 0;
    let current: TimeSelectionVisual | null = null;
    const cancelTouchGate = () => {
      window.clearTimeout(touchTimer);
      window.removeEventListener("touchmove", touchGate, { capture: true, passive: false } as EventListenerOptions);
    };
    const touchGate = (touchEvent: TouchEvent) => {
      if (!selectionStarted) {
        const touch = touchEvent.touches[0];
        if (Math.abs((touch?.clientX ?? originX) - originX) > 8
          || Math.abs((touch?.clientY ?? originY) - originY) > 8) {
          cancel();
        }
        return;
      }
      if (touchEvent.cancelable) touchEvent.preventDefault();
    };
    const beginTouchSelection = () => {
      if (!isTouch) return;
      selectionStarted = true;
      markChipDragActive();
      paintSelection({ clientX: originX, clientY: originY });
    };

    const update = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!selectionStarted) {
        // Pointer events arrive before touchmove in WebView. Until the hold
        // wins, any movement belongs to native scrolling or the page navigator.
        if (Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) > 8) cancel();
        return;
      }
      paintSelection(moveEvent);
    };
    const paintSelection = (moveEvent: { clientX: number; clientY: number }) => {
      const target = columnAtPoint(moveEvent.clientX, moveEvent.clientY);
      if (!target) return;
      let start = { ...anchor };
      let end = { ...target };
      if (differenceInIsoDays(end.date, start.date) < 0
        || (end.date === start.date && end.minutes < start.minutes)) {
        [start, end] = [{ ...end }, { ...start }];
      }
      if (end.date === start.date && end.minutes === start.minutes) {
        end.minutes = start.minutes + 30;
      }
      let endDate = end.date;
      if (end.minutes === 24 * 60 || (end.date === start.date && end.minutes <= start.minutes)) {
        endDate = addIsoDays(end.date, 1);
        end.minutes = 0;
      }
      const segments: TimeSelectionVisual["segments"] = [];
      let segmentDate = start.date;
      while (differenceInIsoDays(endDate, segmentDate) >= 0 && segments.length < 7) {
        const startMinutes = segmentDate === start.date ? start.minutes : 0;
        const endMinutes = segmentDate === endDate ? end.minutes : 24 * 60;
        if (endMinutes > startMinutes) {
          segments.push({ date: segmentDate, startMinutes, endMinutes });
        }
        segmentDate = addIsoDays(segmentDate, 1);
      }
      current = {
        startDate: start.date,
        endDate,
        start: formatClockMinutes(start.minutes),
        end: formatClockMinutes(end.minutes),
        segments,
      };
      setTimeSelection(current);
    };

    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      const draft = current;
      setTimeSelection(null);
      if (!draft || !onNewAt) return;
      onSelectDate(parseISO(draft.startDate));
      onNewAt({
        date: draft.startDate,
        start: draft.start,
        end: draft.end,
        endDate: draft.endDate !== draft.startDate ? draft.endDate : undefined,
        allDay: false,
      });
    };
    const cancel = (cancelEvent?: PointerEvent) => {
      if (cancelEvent && cancelEvent.pointerId !== pointerId) return;
      cleanup();
      setTimeSelection(null);
    };
    function cleanup() {
      cancelTouchGate();
      if (selectionStarted) clearChipDrag();
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (selectionCleanupRef.current === cleanup) selectionCleanupRef.current = null;
    }
    if (isTouch) {
      window.addEventListener("touchmove", touchGate, { capture: true, passive: false } as EventListenerOptions);
      touchTimer = window.setTimeout(beginTouchSelection, 350);
    } else {
      selectionStarted = true;
      paintSelection({ clientX: event.clientX, clientY: event.clientY });
    }
    selectionCleanupRef.current = cleanup;
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  }

  const dateLocale = locale === "zh" ? zhCN : enUS;
  const hourMarks = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    tilt: (((hour * 53) % 9) - 4) * 0.72,
    sway: 7 + ((hour * 29) % 6),
  }));
  const todayKey = dateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const columnTemplate = `${TIME_GUTTER}px repeat(${visibleDays}, minmax(0, 1fr))`;
  // The header was tightened by 12px; keep that space in the all-day lane
  // instead of letting the timed grid silently absorb the reclaimed height.
  const laneHeight = Math.max(94, lane.rowCount * LANE_PITCH + 34);
  const boardMinWidth = TIME_GUTTER + visibleDays * 86;
  const openEntry = (entry: Entry) => {
    if (Date.now() < suppressOpenUntilRef.current) return;
    onEdit(entry);
  };

  // Board-level drag preview. Splitting the schedule into civil-day segments
  // lets a moved or resized item continue visibly across midnight instead of
  // stretching invisibly inside the origin column's overflow clip.
  const timedGhostSegments = (() => {
    const gv = dragVisual;
    if (!gv || !gv.moved || !gv.patch.start) return [];
    const preview = dragPreviewEntry(gv.entry, gv.patch);
    if (!preview) return [];
    return dayKeys.flatMap((key) => {
      const segment = entrySegmentForDate(preview, key);
      if (!segment) return [];
      return [{
        key,
        entry: segment.entry,
        startMinutes: segment.startMinutes,
        endMinutes: segment.endMinutes,
        continuesBefore: segment.continuesBefore,
        continuesAfter: segment.continuesAfter,
      }];
    });
  })();
  const allDayGhost = (() => {
    const gv = dragVisual;
    if (!gv || !gv.moved || !gv.patch.allDay) return null;
    if (!dayData.some((day) => day.key === gv.patch.date)) return null;
    return { entry: gv.entry, date: gv.patch.date };
  })();

  if (photosOnly) {
    return (
      <PhotoWallView
        entries={entries}
        selectedDate={rangeStart}
        days={visibleDays}
        locale={locale}
        settings={settings}
        onSelectDate={onSelectDate}
      />
    );
  }

  return (
    <section
      ref={calendarRef}
      className="day-view panel"
      style={{
        "--calendar-days": visibleDays,
        "--hour-height": `${hourHeight}px`,
        "--snap-height": `${hourHeight * timeScale / 60}px`,
      } as React.CSSProperties}
    >
      {/* One scroll container for headers, the all-day lane and the time grid.
          Because every row lives inside the same scroller and shares one grid
          template, the vertical rules can never drift apart when a scrollbar
          appears — the bug a separately-scrolled header always reintroduces. */}
      <div ref={scrollRef} className="calendar-scroll">
        <div className="calendar-board" style={{ minWidth: `${boardMinWidth}px` }}>
        <div className="calendar-sticky-head" data-view-swipe>
          <div className="calendar-day-headers" style={{ gridTemplateColumns: columnTemplate }}>
            <span className="calendar-corner" />
            {dayKeys.map((key) => {
              const date = parseISO(key);
              const selected = dateKey(selectedDate) === key;
              return (
                <button
                  key={key}
                  className={`calendar-day-header${selected ? " is-selected" : ""}${key === todayKey ? " is-today" : ""}`}
                  type="button"
                  onClick={() => onSelectDate(date)}
                  title={showLunar ? lunarDescription(date) : undefined}
                >
                  <span>{format(date, "EEE", { locale: dateLocale })}</span>
                  <strong>{format(date, "d")}</strong>
                  {showLunar && <em className="calendar-day-lunar">{lunarCellLabel(date)}</em>}
                </button>
              );
            })}
          </div>

          <div
            className="calendar-all-day-grid"
            style={{
              gridTemplateColumns: columnTemplate,
              gridTemplateRows: `repeat(${lane.rowCount}, ${LANE_PITCH}px) 1fr`,
              minHeight: `${laneHeight}px`,
            }}
          >
            <span className="calendar-axis-label" style={{ gridRow: "1 / -1" }}>{t("allDay", locale)}</span>
            {dayData.map(({ key }, column) => (
              <div
                key={key}
                className={`calendar-all-day-cell${key === todayKey ? " is-today" : ""}${dragVisual?.moved && dragVisual.patch.date === key ? " is-drop-target" : ""}`}
                data-date={key}
                style={{ gridColumn: column + 2, gridRow: "1 / -1" }}
                onDoubleClick={() => onNewAt?.({ date: key, allDay: true })}
              >
                {photos[key] && <DayPhotoBackground images={photos[key]} />}
                {onNewAt && <button type="button" className="calendar-all-day-add" onClick={(event) => { event.stopPropagation(); onNewAt({ date: key, allDay: true }); }} aria-label={`${t("newEntry", locale)} · ${key}`} title={t("newEntry", locale)}><Icon name="plus" size={11} /></button>}
              </div>
            ))}
            {dayData.map(({ key, expense }, column) => expense > 0 ? (
              <ExpenseBox
                key={`expense-${key}`}
                amount={expense}
                settings={settings}
                locale={locale}
                variant="calendar"
                className="all-day-expense"
                style={{ gridColumn: column + 2, gridRow: 1 }}
              />
            ) : null)}
            {lane.items.map((item) => {
              const itemKey = `${item.entry.id}:${item.key}`;
              const visual = dragVisual?.key === itemKey ? dragVisual : null;
              const laneStartKey = addIsoDays(dayData[0]?.key ?? todayKey, item.startColumn);
              const past = isPastCalendarSpan(laneStartKey, item.span, todayKey);
              return (
                <ItemChip
                  key={item.key}
                  entry={item.entry}
                  settings={settings}
                  locale={locale}
                  variant="all-day"
                  past={past}
                  dragging={visual != null && visual.moved && visual.edge !== "move"}
                  dragSource={visual != null && visual.moved && visual.edge === "move"}
                  continuesBefore={item.continuesBefore}
                  continuesAfter={item.continuesAfter}
                  style={{
                    gridColumn: `${item.startColumn + 2} / span ${item.span}`,
                    gridRow: item.row + 1,
                  }}
                  onPointerDown={(event) => beginGesture(event, item.entry, "move", itemKey, true)}
                  onOpen={openEntry}
                  onStatusToggle={(entry) => onToggle(entry.id, entry)}
                  onMenu={onEntryMenu}
                >
                  {item.entry.kind !== "bill" && !item.continuesBefore && <span className="calendar-span-handle calendar-span-handle--start" onPointerDown={(event) => beginGesture(event, item.entry, "resize-start", itemKey, true)} />}
                  {item.entry.kind !== "bill" && !item.continuesAfter && <span className="calendar-span-handle calendar-span-handle--end" onPointerDown={(event) => beginGesture(event, item.entry, "resize-end", itemKey, true)} />}
                </ItemChip>
              );
            })}
            {allDayGhost && (
              <ItemChip
                entry={allDayGhost.entry}
                settings={settings}
                locale={locale}
                variant="all-day"
                ghost
                style={{ gridColumn: dayData.findIndex((day) => day.key === allDayGhost.date) + 2, gridRow: Math.max(1, lane.rowCount) }}
              />
            )}
          </div>
        </div>

        <div className="calendar-grid-canvas" style={{ height: `${24 * hourHeight}px`, gridTemplateColumns: `${TIME_GUTTER}px minmax(0, 1fr)` }}>
          <div className="calendar-time-axis">
            {hourMarks.map(({ hour, tilt, sway }) => (
              <span
                key={hour}
                style={{
                  top: `${hour * hourHeight}px`,
                  "--hour-tilt": `${tilt.toFixed(2)}deg`,
                  "--hour-sway": `${sway}s`,
                } as React.CSSProperties}
              >
                {hour}
              </span>
            ))}
          </div>
         <div className="calendar-columns" style={{ gridTemplateColumns: `repeat(${visibleDays}, minmax(0, 1fr))` }}>
            {dayData.map(({ key, timed }) => {
              const overflowGroups = timedOverflow.get(key);
              return (
              <div
                key={key}
                data-date={key}
                className={`calendar-day-column${key === todayKey ? " is-today" : ""}${dragVisual?.moved && dragVisual.patch.date === key ? " is-drop-target" : ""}`}
                onDoubleClick={(event) => handleEmptyDoubleClick(event, key)}
                onPointerDown={(event) => beginTimeSelection(event, key)}
              >
                <div
                  className={`calendar-hour-lines${timeScale < 60 ? " calendar-hour-lines--snap" : ""}`}
                  aria-hidden="true"
                />
                {hourMarks.filter(({ hour }) => hour > 0).map(({ hour }) => (
                  <span
                    key={`hour-sep-${hour}`}
                    className="calendar-hour-line"
                    style={{ top: `${hour * hourHeight - 3}px` }}
                    aria-hidden="true"
                  />
                ))}
                {key === todayKey && <span className="calendar-now-line" style={{ top: `${nowMinutes * pixelsPerMinute}px` }} />}
                {timeSelection?.segments.filter((segment) => segment.date === key).map((segment, segmentIndex) => (
                  <div
                    key={segment.date}
                    className={segmentIndex === 0 ? "calendar-time-selection" : "calendar-time-selection is-continuation"}
                    style={{
                      top: `${segment.startMinutes * pixelsPerMinute}px`,
                      height: `${Math.max(22, (segment.endMinutes - segment.startMinutes) * pixelsPerMinute)}px`,
                    }}
                    aria-hidden="true"
                  >
                    {timeSelection && segmentIndex === 0 && <span>{`${timeSelection.start} – ${timeSelection.end}`}</span>}
                  </div>
                ))}
                {timedGhostSegments.filter((segment) => segment.key === key).map((segment) => (
                  <ItemChip
                    key={`drag-ghost-${segment.key}`}
                    entry={segment.entry}
                    settings={settings}
                    locale={locale}
                    variant="timed"
                    ghost
                    detailLines={timedDetailLines(Math.max(21, (segment.endMinutes - segment.startMinutes) * pixelsPerMinute, timedItemMinHeightPx(segment.entry.kind === "bill", pixelsPerMinute)))}
                    continuesBefore={segment.continuesBefore}
                    continuesAfter={segment.continuesAfter}
                    style={{
                      top: `${segment.startMinutes * pixelsPerMinute}px`,
                      height: `${Math.max(21, (segment.endMinutes - segment.startMinutes) * pixelsPerMinute, timedItemMinHeightPx(segment.entry.kind === "bill", pixelsPerMinute))}px`,
                      left: "2px",
                      width: "calc(100% - 4px)",
                    }}
                  />
                ))}
               {timed.map((placement) => {
                 const itemKey = placementKey(placement);
                  const groupOverflow = overflowGroups?.get(placement.groupId);
                  const effectiveColumnCount = groupOverflow?.visibleColumnCount ?? placement.columnCount;
                  // Skip items whose column falls past the visible limit —
                  // they are represented by the vertical indicator bar below.
                  if (groupOverflow && placement.column >= groupOverflow.visibleColumnCount) return null;
                  const visual = dragVisual?.key === itemKey ? dragVisual : null;
                  const past = isPastCalendarItem(placement.entry, key, todayKey, nowMinutes, placement.endMinutes);
                  const activeDrag = dragVisual?.moved
                    && dragVisual.entry.id === placement.entry.id
                    ? dragVisual
                    : null;
                  // The board ghost is the authoritative schedule preview.
                  // Resize must hide every source segment; a move keeps only
                  // its dashed origin marker while the ghost shows landing.
                  if (activeDrag?.mode === "schedule") {
                    if (activeDrag.edge !== "move" || placement.date !== activeDrag.sourceDate) return null;
                  } else if (activeDrag) {
                    return null;
                  }
                  const duration = Math.max(placement.endMinutes - placement.startMinutes, placement.entry.kind === "bill" ? 15 : 20);
                  const minHeight = timedItemMinHeightPx(placement.entry.kind === "bill", pixelsPerMinute);
                  const renderedHeight = Math.max(duration * pixelsPerMinute, minHeight);
                  // A 23:59 instant still needs a tappable block. Clamp only the
                  // painted top; its meta keeps the exact start time.
                  const top = Math.min(
                    placement.startMinutes * pixelsPerMinute,
                    Math.max(0, 24 * hourHeight - minHeight),
                  );
                  const height = renderedHeight;
                  // A *move* leaves the origin as a dashed, empty outline
                  // (dragSource) while the light ghost previews the landing
                  // slot. Resize ghosts replace all source segments.
                  const isMove = visual != null && visual.moved && visual.edge === "move";
                  return (
                    <ItemChip
                      key={itemKey}
                      entry={placement.entry}
                      settings={settings}
                      locale={locale}
                      variant="timed"
                      past={past}
                      dragging={false}
                      dragSource={isMove}
                      detailLines={timedDetailLines(renderedHeight)}
                      continuesBefore={placement.continuesBefore}
                      continuesAfter={placement.continuesAfter}
                      style={{
                        top: `${top}px`,
                        height: `${Math.max(21, height)}px`,
                        left: `calc(${(placement.column / effectiveColumnCount) * 100}% + 2px)`,
                        width: `calc(${100 / effectiveColumnCount}% - 4px)`,
                      }}
                      onPointerDown={(event) => beginGesture(event, placement.entry, "move", itemKey, false, placement.date)}
                      onOpen={openEntry}
                      onStatusToggle={(entry) => onToggle(entry.id, entry)}
                      onMenu={onEntryMenu}
                    >
                      {placement.entry.kind !== "bill" && !placement.continuesBefore && <span className="calendar-resize-handle calendar-resize-handle--start" onPointerDown={(event) => beginGesture(event, placement.entry, "resize-start", itemKey, false, placement.date)} />}
                      {placement.entry.kind !== "bill" && !placement.continuesAfter && <span className="calendar-resize-handle calendar-resize-handle--end" onPointerDown={(event) => beginGesture(event, placement.entry, "resize-end", itemKey, false, placement.date)} />}
                   </ItemChip>
                 );
               })}
                {overflowGroups && [...overflowGroups.values()].map((group) => (
                  <button
                    key={`timed-overflow-${group.topMinutes}`}
                    type="button"
                    className="timed-overflow-bar"
                    style={{
                      top: `${group.topMinutes * pixelsPerMinute}px`,
                      height: `${Math.max(22, (group.bottomMinutes - group.topMinutes) * pixelsPerMinute)}px`,
                      width: `${TIMED_OVERFLOW_BAR_WIDTH}px`,
                    }}
                    aria-label={t("timedMoreItems", locale).replace("{count}", String(group.hiddenCount))}
                    title={t("timedMoreItems", locale).replace("{count}", String(group.hiddenCount))}
                    onClick={(event) => {
                      event.stopPropagation();
                      const barNode = event.currentTarget as HTMLElement;
                      setTimedPeek({
                        dateKey: key,
                        date: parseISO(key),
                        anchor: barNode.getBoundingClientRect(),
                        entries: group.entries,
                      });
                    }}
                  >
                    <span className="timed-overflow-dots" aria-hidden="true">
                      {Array.from({ length: Math.min(3, group.hiddenCount) }, (_, index) => (
                        <i key={index} className="timed-overflow-dot" />
                      ))}
                    </span>
                  </button>
                ))}
              </div>
              );
            })}
          </div>
        </div>
        </div>
      </div>
      {!dayData.some((day) => day.timed.length || day.all.length) && (
        <button className="day-view-empty" type="button" onClick={onNew}><Icon name="leaf" size={18} />{t("noTimedEntries", locale)}</button>
      )}
      <span className="calendar-live-region" aria-live="polite">{dragAnnounce}</span>
      {dragVisual?.moved && (
       <div className="drag-info-tooltip" role="status">
         {dragAnnounce}
       </div>
     )}
      {timedPeek && (
        <MonthDayPeek
          anchor={timedPeek.anchor}
          date={timedPeek.date}
          dateKey={timedPeek.dateKey}
          entries={timedPeek.entries}
          expense={0}
          settings={settings}
          locale={locale}
          showLunar={false}
          onClose={() => setTimedPeek(null)}
          onToggle={onToggle}
          onEdit={onEdit}
          onEntryMenu={onEntryMenu}
          onOpenDay={() => setTimedPeek(null)}
        />
      )}
    </section>
  );
}
