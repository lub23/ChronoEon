import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, endOfMonth, endOfWeek, format, getISOWeek, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { applyCalendarDrag, differenceInIsoDays, isEntryPast, type CalendarSchedulePatch } from "@chronoeon/domain";
import type { ChronoEonSettings, Entry, Locale } from "../domain/entry";
import { entriesForDate } from "../domain/entry";
import { kindAllowed, type AgendaFilter } from "../domain/agendaTimeline";
import { getLunarInfo, lunarCellLabel, shouldShowLunar, type LunarPreference } from "../domain/lunar";
import { layoutMonthGrid, monthSlotCapacity, MONTH_SLOT_PITCH as SLOT_PITCH, MONTH_SLOT_HEIGHT as SLOT_HEIGHT, MONTH_MORE_HEIGHT } from "../domain/monthLayout";
import { entryMatchesSearch } from "../domain/search";
import { useDayPhotos } from "../hooks/useDayPhotos";
import { t } from "../i18n";
import { DayPhotoBackground } from "./DayPhotoBackground";
import { openImagePreview } from "./photoPreviewBus";
import { clearChipDrag, markChipDragActive } from "./dragGesture";
import { ExpenseBox } from "./ExpenseBox";
import { Icon } from "./Icon";
import { ItemChip } from "./ItemChip";
import { MonthDayPeek } from "./MonthDayPeek";
interface MonthViewProps {
  entries: Entry[];
  selectedDate: Date;
  locale: Locale;
  settings: ChronoEonSettings;
  filter: AgendaFilter;
  search: string;
  weekStartsOn?: ChronoEonSettings["firstDay"];
  showWeekNumbers?: boolean;
  lunar?: LunarPreference;
  showPhotos?: boolean;
  /** Photo appreciation: hide every chip and keep the days' photos. */
  photosOnly?: boolean;
  onSelectDate: (date: Date) => void;
  onOpenAgenda: () => void;
  onToggle: (id: string, entry?: Entry) => void;
  onEdit: (entry: Entry) => void;
  onEntryMenu?: (entry: Entry, event: React.MouseEvent) => void;
  onNewAt?: (date: string) => void;
  onReschedule: (entry: Entry, patch: CalendarSchedulePatch) => void | Promise<void>;
}

/** Default head band; the real height is measured from the DOM so the JS
    layout (slot count, banners, ghosts) can never drift from whatever the
    CSS breakpoints make the head. */
const DEFAULT_HEAD_HEIGHT = 34;
type MonthDragEdge = "move" | "resize-start" | "resize-end";

interface MonthDragVisual {
  key: string;
  edge: MonthDragEdge;
  targetDate: string;
  /** The entry being dragged; re-used to render the landing-position ghost. */
  entry: Entry;
  patch: CalendarSchedulePatch;
  moved: boolean;
}

/** The day whose "+N" badge was pressed, with the cell rect to anchor against. */
interface MonthPeek {
  dateKey: string;
  date: Date;
  anchor: DOMRect;
}

export function MonthView({
  entries,
  selectedDate,
  locale,
  settings,
  filter,
  search,
  weekStartsOn = 1,
  showWeekNumbers = false,
  lunar = "auto",
  showPhotos = true,
  photosOnly = false,
  onSelectDate,
  onOpenAgenda,
  onToggle,
  onEdit,
  onEntryMenu,
  onNewAt,
  onReschedule,
}: MonthViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const [measure, setMeasure] = useState(() => ({
    panelWidth: 900,
    panelHeight: 650,
    cellHeight: 120,
    headHeight: DEFAULT_HEAD_HEIGHT,
  }));
  const [dragVisual, setDragVisual] = useState<MonthDragVisual | null>(null);
  const [dragAnnounce, setDragAnnounce] = useState("");
  const [peek, setPeek] = useState<MonthPeek | null>(null);
  const gestureCleanupRef = useRef<(() => void) | null>(null);
  const suppressOpenUntilRef = useRef(0);
  // Touch long-press gate — same parity behaviour as DayView / the plugin, so a
  // touch on a month chip does not instantly steal scroll from the grid.
  const pendingTouchRef = useRef<{ startX: number; startY: number; timer: number } | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const grid = gridRef.current;
    if (!panel) return;
    // rAF-throttle: coalesce every ResizeObserver burst into one read per
    // frame. Without this, a window-resize drag fires the callback dozens of
    // times per second, each one forcing a synchronous layout reflow (clientWidth,
    // clientHeight, getBoundingClientRect) and triggering a React re-render that
    // repaints every vine background — the visible "border flicker".
    let frame = 0;
    const run = () => {
      frame = 0;
      const panelWidth = panel.clientWidth || 900;
      const panelHeight = panel.clientHeight || 650;
      const gridHeight = grid?.clientHeight || 660;
      // Read the head band the browser actually rendered (26px on phones, 24px
      // elsewhere) so slot math and banner offsets track the CSS exactly. Cache
      // the element so we don't run querySelector on every frame.
      if (!headRef.current) headRef.current = panel.querySelector<HTMLDivElement>(".month-day-head");
      const head = headRef.current;
      const headH = head ? Math.round(head.getBoundingClientRect().height) || DEFAULT_HEAD_HEIGHT : DEFAULT_HEAD_HEIGHT;
      const next = { panelWidth, panelHeight, cellHeight: Math.max(56, gridHeight / 6), headHeight: headH };
      setMeasure(current => Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(run);
    };
    // The initial measurement runs synchronously so the first render has
    // correct slot/banner math; only subsequent ResizeObserver callbacks are
    // rAF-throttled to coalesce resize bursts into one update per frame.
    run();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => () => gestureCleanupRef.current?.(), []);

  const { panelWidth, panelHeight, cellHeight, headHeight } = measure;
  const density = panelWidth < 560 || panelHeight < 520 ? "compact" : panelWidth < 900 ? "comfortable" : "roomy";
  // Slot count follows the measured cell rather than a breakpoint guess, so a
  // tall window really does show more per day instead of leaving dead space.
  const capacity = useMemo(() => monthSlotCapacity(cellHeight - headHeight - 2), [cellHeight, headHeight]);

  const monthStart = startOfMonth(selectedDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn });
  const gridEnd = endOfWeek(endOfMonth(selectedDate), { weekStartsOn });
  const days = useMemo(() => {
    const list: Date[] = [];
    for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) list.push(cursor);
    while (list.length < 42) list.push(addDays(list[list.length - 1], 1));
    return list.slice(0, 42);
  }, [gridEnd.getTime(), gridStart.getTime()]);
  const dayKeys = useMemo(() => days.map((day) => format(day, "yyyy-MM-dd")), [days]);

  // The peek is anchored to a cell rect, so anything that moves the grid — a
  // month step, a resize, a slot-count change — invalidates it. Closing is the
  // honest response; re-deriving a stale rect would park the panel over the
  // wrong day.
  useEffect(() => { setPeek(null); }, [dayKeys, capacity]);
  useEffect(() => {
    if (!peek) return;
    const close = () => setPeek(null);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [peek]);

  const layout = useMemo(() => layoutMonthGrid(
    dayKeys,
    (date) => entriesForDate(entries, date)
      .filter((entry) => kindAllowed(filter, entry.kind))
      .filter((entry) => entryMatchesSearch(entry, search, locale)),
    capacity,
    (date) => entriesForDate(entries, date),
    settings,
  ), [capacity, dayKeys, entries, filter, locale, search, settings]);

  const entriesByDate = useMemo(() => {
    const map: Record<string, Entry[]> = {};
    for (const key of dayKeys) map[key] = entriesForDate(entries, key);
    return map;
  }, [dayKeys, entries]);
  const photos = useDayPhotos(entriesByDate, photosOnly || showPhotos, settings.photoDisplayMode);

  const dateLocale = locale === "zh" ? zhCN : enUS;
  const weekDays = Array.from({ length: 7 }, (_, index) => format(addDays(gridStart, index), "EEE", { locale: dateLocale }));
  const today = new Date();
  const todayKey = format(today, "yyyy-MM-dd");
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const showLunar = shouldShowLunar(lunar, locale);
  // The rail owns its grid track at every width. Deriving visibility here keeps
  // the grid-column mapping for every civil day in lockstep with the rail.
  const showGutter = showWeekNumbers;

  function cellDateAtPoint(clientX: number, clientY: number): string | null {
    const cells = gridRef.current?.querySelectorAll<HTMLElement>(".month-day[data-date]");
    if (!cells?.length) return null;
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return cell.dataset.date ?? null;
      }
    }
    return null;
  }

  function beginMonthGesture(event: React.PointerEvent<HTMLElement>, entry: Entry, edge: MonthDragEdge, key: string) {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const originY = event.clientY;
    if (event.pointerType === "touch") {
      if (pendingTouchRef.current) {
        window.clearTimeout(pendingTouchRef.current.timer);
        pendingTouchRef.current = null;
      }
      const cancelPending = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", onPendingMove, true);
        window.removeEventListener("pointerup", onPendingUp, { capture: true } as EventListenerOptions);
        if (pendingTouchRef.current?.timer === timer) pendingTouchRef.current = null;
      };
      const onPendingMove = (moveEvent: PointerEvent) => {
        if (Math.abs(moveEvent.clientX - originX) > 8 || Math.abs(moveEvent.clientY - originY) > 8) cancelPending();
      };
      const onPendingUp = () => cancelPending();
      const timer = window.setTimeout(() => {
        pendingTouchRef.current = null;
        enterMonthGesture();
      }, 300);
      pendingTouchRef.current = { startX: originX, startY: originY, timer };
      window.addEventListener("pointermove", onPendingMove, true);
      window.addEventListener("pointerup", onPendingUp, { capture: true } as EventListenerOptions);
      return;
    }
    enterMonthGesture();

    function enterMonthGesture() {
      const grabbedDate = cellDateAtPoint(originX, originY) ?? entry.date;
      const resizeAnchor = edge === "resize-end" ? (entry.endDate ?? entry.date) : entry.date;
      let latest: MonthDragVisual = {
        key,
        edge,
        targetDate: grabbedDate,
        entry,
        patch: applyCalendarDrag(entry, { edge }),
        moved: false,
      };
      setDragVisual(latest);
      setDragAnnounce(monthAnnounceFor(entry, latest, grabbedDate, locale));
      markChipDragActive();

      const update = (moveEvent: PointerEvent) => {
        const targetDate = cellDateAtPoint(moveEvent.clientX, moveEvent.clientY);
        if (!targetDate) return;
        const anchor = edge === "move" ? grabbedDate : resizeAnchor;
        const deltaDays = differenceInIsoDays(targetDate, anchor);
        latest = {
          key,
          edge,
          targetDate,
          entry,
          patch: applyCalendarDrag(entry, { days: deltaDays, edge }),
          moved: deltaDays !== 0,
        };
        setDragVisual(latest);
        setDragAnnounce(monthAnnounceFor(entry, latest, targetDate, locale));
      };
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
        if (!latest.moved) return;
        suppressOpenUntilRef.current = Date.now() + 500;
        void onReschedule(entry, latest.patch);
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

  function monthAnnounceFor(entry: Entry, visual: MonthDragVisual, targetDate: string, locale: Locale): string {
    const dateText = locale === "zh"
      ? format(parseISO(targetDate), "M月d日")
      : format(parseISO(targetDate), "MMM d");
    const endDate = visual.patch.endDate && visual.patch.endDate !== visual.patch.date
      ? ` ${locale === "zh" ? "至" : "to"} ${locale === "zh" ? format(parseISO(visual.patch.endDate), "M月d日") : format(parseISO(visual.patch.endDate), "MMM d")}`
      : "";
    const verb = visual.edge === "move"
      ? t("dragInfoMoveAllDay", locale).replace("{date}", dateText)
      : t("dragInfoResize", locale).replace("{start}", dateText).replace("{endSuffix}", endDate);
    return verb;
  }

  const openEntry = (entry: Entry) => {
    if (Date.now() < suppressOpenUntilRef.current) return;
    onEdit(entry);
  };

  /**
   * Keyboard access for the grid itself. The cells were plain `div`s with a
   * click handler: selecting a day and the double-click "new entry on this day"
   * shortcut were mouse-only, and a screen reader was told nothing at all. The
   * grid is now the standard roving-tabindex date grid (one tab stop, arrows
   * move the selection, Enter/Space opens the day, so keyboard and pointer
   * reach the same two actions).
   */
  function focusDayCell(dateKey: string) {
    gridRef.current?.querySelector<HTMLElement>(`.month-day[data-date="${dateKey}"]`)?.focus();
  }

  function onCellKeyDown(event: React.KeyboardEvent<HTMLDivElement>, day: Date, dayIndex: number) {
    const step = event.key === "ArrowLeft" ? -1
      : event.key === "ArrowRight" ? 1
      : event.key === "ArrowUp" ? -7
      : event.key === "ArrowDown" ? 7
      : event.key === "Home" ? -(dayIndex % 7)
      : event.key === "End" ? 6 - (dayIndex % 7)
      : null;
    if (step !== null) {
      event.preventDefault();
      const next = addDays(day, step);
      onSelectDate(next);
      const nextKey = format(next, "yyyy-MM-dd");
      // Inside the rendered grid the cell already exists; a step past its edge
      // moves the month, so focus lands after the new grid paints.
      requestAnimationFrame(() => focusDayCell(nextKey));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const cell = layout.cells.get(dayKeys[dayIndex]);
      // Enter on a day with hidden items opens the same peek the badge does, so
      // the keyboard is never the path that cannot see the whole day.
      if (cell && (cell.overflow > 0 || cell.entries.length)) {
        if (isSameMonth(day, selectedDate)) onSelectDate(day);
        setPeek({ dateKey: dayKeys[dayIndex], date: day, anchor: event.currentTarget.getBoundingClientRect() });
      } else {
        onSelectDate(day);
        onNewAt?.(dayKeys[dayIndex]);
      }
    }
  }

  return (
    <div className={`month-layout month-layout--full month-layout--${density}`}>
      <section ref={panelRef} className="month-panel panel">
        <div className="month-weekdays" role="row">
          {weekDays.map((day) => <span key={day} role="columnheader">{day}</span>)}
          {showGutter && <span className="month-week-gutter" aria-hidden="true" />}
        </div>
        <div
          ref={gridRef}
          className={showGutter ? "month-grid has-week-numbers" : "month-grid"}
          role="grid"
          aria-label={format(selectedDate, locale === "zh" ? "yyyy年M月" : "MMMM yyyy", { locale: dateLocale })}
        >
          {showGutter && days.filter((_, index) => index % 7 === 0).map((day, index) => (
            <span key={`w-${format(day, "yyyy-MM-dd")}`} className="month-week-number" style={{ gridColumn: 8, gridRow: index + 1 }} title={t("showWeekNumbers", locale)}>{getISOWeek(day)}</span>
          ))}

          {days.map((day, dayIndex) => {
            const key = dayKeys[dayIndex];
            const cell = layout.cells.get(key);
            const selected = isSameDay(day, selectedDate);
            const current = isSameDay(day, today);
            const lunarInfo = showLunar ? getLunarInfo(day) : null;
            const lunarText = lunarInfo ? lunarCellLabel(day) : "";
            const festive = Boolean(lunarInfo && (lunarInfo.lunarFestivals.length || lunarInfo.solarFestivals.length || lunarInfo.isHoliday));
            const dayPhotos = photos[key];
            return (
              <div
                key={key}
                className={[
                  "month-day",
                  !isSameMonth(day, selectedDate) ? "is-outside" : "",
                  selected ? "is-selected" : "",
                  current ? "is-today" : "",
                  lunarInfo?.isHoliday ? "is-holiday" : "",
                  dayPhotos ? "has-photo" : "",
                  dragVisual?.moved && dragVisual.targetDate === key ? "is-drop-target" : "",
                ].filter(Boolean).join(" ")}
                data-date={key}
                role="gridcell"
                aria-selected={selected}
                aria-label={[
                  format(day, locale === "zh" ? "yyyy年M月d日 EEEE" : "EEEE, MMMM d, yyyy", { locale: dateLocale }),
                  cell?.entries.length ? `${cell.entries.length} ${t("entriesCount", locale)}` : t("noEntries", locale),
                ].join(" · ")}
                tabIndex={selected ? 0 : -1}
                style={{ gridColumn: (dayIndex % 7) + 1, gridRow: Math.floor(dayIndex / 7) + 1 }}
                onClick={() => onSelectDate(day)}
                onDoubleClick={() => onNewAt?.(key)}
                onKeyDown={(event) => onCellKeyDown(event, day, dayIndex)}
              >
                {dayPhotos && (
                  <DayPhotoBackground
                    images={dayPhotos}
                    onOpen={photosOnly ? () => openImagePreview(dayPhotos, 0) : undefined}
                    openLabel={t("photoPreview", locale)}
                  />
                )}

                {/* Fixed metadata row. Its soft gradient keeps the date and
                    lunar label readable when a photo fills the cell behind it. */}
                <div className="month-day-head" ref={dayIndex === 0 ? headRef : undefined}>
                  <span className="day-number">{format(day, "d")}</span>
                  {lunarText && (
                    <span className={festive ? "day-lunar is-festive" : "day-lunar"} title={lunarText}>
                      {lunarText}{lunarInfo?.isWorkday && <i title={t("holidayWorkday", locale)}>班</i>}
                    </span>
                  )}
                </div>

                <div className="month-day-slots" style={{ "--slot-pitch": `${SLOT_PITCH}px`, "--slot-height": `${SLOT_HEIGHT}px` } as React.CSSProperties}>
                  {!photosOnly && <>
                  {cell && cell.expense > 0 && (
                    <ExpenseBox amount={cell.expense} settings={settings} locale={locale} variant="month" className="month-expense-slot" />
                  )}
                  {cell?.placements.map(({ entry, slot }) => (
                    <ItemChip
                      key={entry.id}
                      entry={entry}
                      settings={settings}
                      locale={locale}
                      variant="month"
                      style={{ top: `${slot * SLOT_PITCH}px` }}
                      compactLabel={density === "compact"}
                      past={isEntryPast(entry, todayKey, nowMinutes)}
                      dragging={dragVisual?.key === `${entry.id}:${key}` && dragVisual.moved && dragVisual.edge !== "move"}
                      dragSource={dragVisual?.key === `${entry.id}:${key}` && dragVisual.moved && dragVisual.edge === "move"}
                      onPointerDown={(event) => beginMonthGesture(event, entry, "move", `${entry.id}:${key}`)}
                      onOpen={openEntry}
                      onStatusToggle={(target) => onToggle(target.id, target)}
                      onMenu={onEntryMenu}
                    />
                  ))}
                  {cell && cell.overflow > 0 && (
                    <button
                      type="button"
                      className="month-more"
                      style={{ top: `${capacity.withOverflow * SLOT_PITCH}px`, height: `${MONTH_MORE_HEIGHT}px` }}
                      aria-haspopup="dialog"
                      aria-expanded={peek?.dateKey === key}
                      aria-label={t("monthMoreItems", locale)
                        .replace("{count}", String(cell.overflow))
                        .replace("{date}", format(day, locale === "zh" ? "M月d日" : "MMM d", { locale: dateLocale }))}
                      title={t("monthMoreItems", locale)
                        .replace("{count}", String(cell.overflow))
                        .replace("{date}", format(day, locale === "zh" ? "M月d日" : "MMM d", { locale: dateLocale }))}
                      onClick={(event) => {
                        event.stopPropagation();
                        // Trailing/leading days belong to this grid too. Do not
                        // navigate to their month just to inspect hidden items.
                        if (isSameMonth(day, selectedDate)) onSelectDate(day);
                        // Anchor on the cell, not the badge: the popover should
                        // read as "this day, expanded".
                        const cellNode = (event.currentTarget as HTMLElement).closest<HTMLElement>(".month-day");
                        setPeek(cellNode ? { dateKey: key, date: day, anchor: cellNode.getBoundingClientRect() } : null);
                      }}
                    >
                      <span className="month-more-dots" aria-hidden="true">
                        {Array.from({ length: Math.min(3, cell.overflow) }, (_, index) => (
                          <i key={index} className="month-more-dot" />
                        ))}
                      </span>
                    </button>
                  )}
                  </>}
                </div>
              </div>
            );
          })}

          {/* Multi-day entries are drawn once at grid level so they can cross
              cell borders instead of being clipped into per-day fragments. */}
          {!photosOnly && layout.banners.map((banner) => (
            <ItemChip
              key={banner.key}
              entry={banner.entry}
              settings={settings}
              locale={locale}
              variant="month"
              className="month-banner"
              continuesBefore={banner.continuesBefore}
              continuesAfter={banner.continuesAfter}
              compactLabel={density === "compact"}
              past={isEntryPast(banner.entry, todayKey, nowMinutes)}
              style={{
                gridColumn: `${banner.startColumn + 1} / span ${banner.span}`,
                gridRow: banner.row + 1,
                marginTop: `${headHeight + banner.slot * SLOT_PITCH}px`,
                height: `${SLOT_HEIGHT}px`,
              }}
              dragging={dragVisual?.key === banner.key && dragVisual.moved && dragVisual.edge !== "move"}
              dragSource={dragVisual?.key === banner.key && dragVisual.moved && dragVisual.edge === "move"}
              onPointerDown={(event) => beginMonthGesture(event, banner.entry, "move", banner.key)}
              onOpen={openEntry}
              onStatusToggle={(target) => onToggle(target.id, target)}
              onMenu={onEntryMenu}
            >
              {banner.entry.kind !== "bill" && !banner.continuesBefore && (
                <span className="calendar-span-handle calendar-span-handle--start" onPointerDown={(event) => beginMonthGesture(event, banner.entry, "resize-start", banner.key)} />
              )}
              {banner.entry.kind !== "bill" && !banner.continuesAfter && (
                <span className="calendar-span-handle calendar-span-handle--end" onPointerDown={(event) => beginMonthGesture(event, banner.entry, "resize-end", banner.key)} />
              )}
            </ItemChip>
          ))}

          {/* Landing preview for a month drag: a light item at the future
              row/column footprint so the user sees the planned span (a
              single-day move is one light chip in the target cell, a multi-day
              move/resize is a light banner across the span). The source chip
              stays as a dashed outline at the origin; the ghost always
              reflects the drop target, which differs from the origin for a
              moved gesture. */}
          {dragVisual?.moved && dragVisual.patch.date && (
            <MonthDragGhost
              patch={dragVisual.patch}
              entry={dragVisual.entry}
              settings={settings}
              locale={locale}
              gridStart={gridStart}
              headHeight={headHeight}
              compactLabel={density === "compact"}
            />
          )}
        </div>
      </section>
      <span className="calendar-live-region" aria-live="polite">{dragAnnounce}</span>
      {dragVisual?.moved && (
        <div className="drag-info-tooltip" role="status">{dragAnnounce}</div>
      )}
      {peek && (
        <MonthDayPeek
          anchor={peek.anchor}
          date={peek.date}
          dateKey={peek.dateKey}
          entries={(layout.cells.get(peek.dateKey)?.overflow
            ? layout.cells.get(peek.dateKey)?.hiddenEntries
            : layout.cells.get(peek.dateKey)?.entries) ?? []}
          expense={layout.cells.get(peek.dateKey)?.expense ?? 0}
          settings={settings}
          locale={locale}
          showLunar={showLunar}
          onClose={() => { setPeek(null); focusDayCell(peek.dateKey); }}
          onToggle={onToggle}
          onEdit={onEdit}
          onEntryMenu={onEntryMenu}
          onNewAt={onNewAt}
          onOpenDay={() => { onSelectDate(peek.date); onOpenAgenda(); }}
        />
      )}
    </div>
  );
}

/**
 * Landing-position preview for a month drag. Rendered as a light item (the
 * entry's own colour and title) across the future row/column footprint, so the
 * user sees exactly what the drop will look like — a single-day move is one
 * light chip in the target cell, a multi-day move is a light banner across the
 * span. Non-interactive; the origin cell is separately outlined by
 * `is-drag-source`.
 */
function MonthDragGhost({
  patch,
  entry,
  settings,
  locale,
  gridStart,
  headHeight,
  compactLabel,
}: {
  patch: CalendarSchedulePatch;
  entry: Entry;
  settings: ChronoEonSettings;
  locale: Locale;
  gridStart: Date;
  headHeight: number;
  compactLabel: boolean;
}) {
  if (!patch.date) return null;
  const start = parseISO(patch.date);
  const end = patch.endDate ? parseISO(patch.endDate) : start;
  // Clamp to the 6-week grid window. A ghost reaching outside the visible grid
  // would otherwise leave a broken column footprint.
  const gridEnd = addDays(gridStart, 42 - 1);
  const clampedStart = start < gridStart ? gridStart : start;
  const clampedEnd = end > gridEnd ? gridEnd : end;
  if (clampedEnd < clampedStart) return null;
  const startIndex = Math.floor(differenceInIsoDays(format(clampedStart, "yyyy-MM-dd"), format(gridStart, "yyyy-MM-dd")));
  const endIndex = Math.floor(differenceInIsoDays(format(clampedEnd, "yyyy-MM-dd"), format(gridStart, "yyyy-MM-dd")));
  const startRow = Math.floor(startIndex / 7);
  const startCol = (startIndex % 7) + 1;
  const endRow = Math.floor(endIndex / 7);
  const endCol = (endIndex % 7) + 1;
  const rows: number[] = [];
  for (let row = startRow; row <= endRow; row++) rows.push(row);
  return (
    <>
      {rows.map((row) => {
        const colStart = row === startRow ? startCol : 1;
        const colEnd = row === endRow ? endCol : 7;
        const span = colEnd - colStart + 1;
        if (span <= 0) return null;
        return (
          <ItemChip
            key={`ghost-${row}`}
            entry={entry}
            settings={settings}
            locale={locale}
            variant="month"
            className="month-banner is-drag-ghost"
              continuesBefore={row < endRow}
              continuesAfter={row > startRow}
              compactLabel={compactLabel}
            ghost
            style={{
              gridColumn: `${colStart} / span ${span}`,
              gridRow: row + 1,
              marginTop: `${headHeight}px`,
              height: `${SLOT_HEIGHT}px`,
            }}
          />
        );
      })}
    </>
  );
}
