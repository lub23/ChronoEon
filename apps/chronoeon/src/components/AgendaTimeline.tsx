import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Virtuoso, type ListRange, type VirtuosoHandle } from "react-virtuoso";
import { addDays, format, getISOWeek, isToday, parseISO } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { isEntryPast, type ChronoEonSettings, type Entry, type Locale } from "@chronoeon/domain";
import {
  buildTimelineDays,
  groupTimelineItems,
  type AgendaFilter,
  type TimelineDay,
  type TimelineItem,
} from "../domain/agendaTimeline";
import { lunarCellLabel, shouldShowLunar, type LunarPreference } from "../domain/lunar";
import { t } from "../i18n";
import { ExpenseBox } from "./ExpenseBox";
import { Icon } from "./Icon";
import { ItemChip } from "./ItemChip";

/**
 * `week` groups day cards under week headers and virtualizes (List view).
 * `flat` renders the same timeline nodes for the glanceable mini window.
 */
export type TimelineMode = "week" | "flat";

interface AgendaTimelineProps {
  entries: Entry[];
  /** Civil dates to render, ascending. */
  dayKeys: string[];
  selectedKey: string;
  mode: TimelineMode;
  locale: Locale;
  settings: ChronoEonSettings;
  filter: AgendaFilter;
  search: string;
  lunar?: LunarPreference;
  /** Bump to force a re-centre on the selected day even if it did not change. */
  recenterNonce?: number;
  /** Decremented when ListView prepends pages, so Virtuoso preserves scroll. */
  firstItemIndex?: number;
  onFirstItemReached?: () => void;
  onLastItemReached?: () => void;
  onSelectDate?: (date: Date) => void;
  onToggle: (id: string, entry?: Entry) => void;
  onEdit: (entry: Entry) => void;
  /** Called with the civil date the user pointed at, so the composer opens there. */
  onNew: (date?: string) => void;
  onEntryMenu?: (entry: Entry, event: React.MouseEvent) => void;
}

function weekLabel(start: Date, locale: Locale): string {
  const dateLocale = locale === "zh" ? zhCN : enUS;
  const end = addDays(start, 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  if (locale === "zh") {
    return `${format(start, "yyyy年M月d日", { locale: dateLocale })} – ${format(end, sameYear ? "M月d日" : "yyyy年M月d日", { locale: dateLocale })}`;
  }
  return `${format(start, sameYear ? "MMM d" : "MMM d, yyyy", { locale: dateLocale })} – ${format(end, "MMM d, yyyy", { locale: dateLocale })}`;
}

function hashSeed(value: string): number {
  let seed = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    seed ^= value.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return (seed >>> 0) / 4294967295;
}

function minutesFor(entry: Entry): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(entry.start ?? "");
  if (entry.allDay || !match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function vineAxisLabel(entry: Entry, locale: Locale): string {
  if (entry.allDay) return t("allDay", locale);
  return entry.start || t("dateAny", locale);
}

function vineNodeStyle(entry: Entry, index: number, previousMinutes: number | null): CSSProperties {
  const minutes = minutesFor(entry);
  const distance = minutes !== null && previousMinutes !== null ? Math.abs(minutes - previousMinutes) : 0;
  const seed = hashSeed(entry.id);
  return {
    marginTop: index === 0 ? 0 : `${Math.round(4 + Math.min(34, distance / 7))}px`,
    "--vine-color": entry.color,
    "--vine-turn": `${((seed * 18) - 9).toFixed(2)}deg`,
    "--vine-mirror": seed > .5 ? -1 : 1,
    "--vine-bow": `${(3 + seed * 5).toFixed(2)}px`,
    "--vine-sway": `${(11 + seed * 5).toFixed(2)}s`,
    "--vine-delay": `${(-seed * 7).toFixed(2)}s`,
  } as CSSProperties;
}

/**
 * The single chronological engine behind List view, the Day view's timeline
 * layout and the mini window. Every surface shares one projection, one sort
 * order and one empty state; only the density and the grouping differ.
 */
export function AgendaTimeline({
  entries,
  dayKeys,
  selectedKey,
  mode,
  locale,
  settings,
  filter,
  search,
  lunar = "auto",
  recenterNonce = 0,
  firstItemIndex,
  onFirstItemReached,
  onLastItemReached,
  onSelectDate,
  onToggle,
  onEdit,
  onNew,
  onEntryMenu,
}: AgendaTimelineProps) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const dateLocale = locale === "zh" ? zhCN : enUS;
  const searching = Boolean(search.trim());
  const showLunar = shouldShowLunar(lunar, locale) && mode !== "flat";
  const grouped = mode === "week";

  const days = useMemo(
    () => buildTimelineDays({
      entries,
      dayKeys,
      selectedKey,
      filter,
      search,
      locale,
      settings,
      // List keeps empty civil dates in its virtualized sequence. Filtering
      // them makes a selected empty day either disappear or sit at the list
      // endpoint, where backward paging can loop without adding renderable
      // items and destabilize Virtuoso's scroll state.
      includeEmptyDays: true,
      startDateOnly: grouped,
    }),
    [dayKeys, entries, filter, grouped, locale, search, selectedKey, settings],
  );

  const items = useMemo<TimelineItem[]>(
    () => (grouped
      ? groupTimelineItems(days, settings.firstDay)
      : days.map((day) => ({ type: "day" as const, key: `day:${day.key}`, day }))),
    [days, grouped, settings.firstDay],
  );

  const selectedIndex = items.findIndex((item) => item.type === "day" && item.day.selected);
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayIndex = items.findIndex((item) => item.type === "day" && item.day.key === todayKey);
  const [visibleRange, setVisibleRange] = useState({ startIndex: selectedIndex, endIndex: selectedIndex });
  const todayVisible = visibleRange.startIndex >= 0 && visibleRange.endIndex >= visibleRange.startIndex
    && items.slice(Math.max(0, visibleRange.startIndex), visibleRange.endIndex + 1)
      .some((item) => item?.type === "day" && item.day.key === todayKey);
  const handleRangeChange = (range: ListRange) => {
    const base = firstItemIndex ?? 0;
    setVisibleRange({ startIndex: range.startIndex - base, endIndex: range.endIndex - base });
  };
  const scrollToToday = () => {
    if (todayIndex < 0) return;
    // Virtuoso's browser smooth scrolling has no duration contract and can
    // wander across a 12-week list. An immediate index jump is the only way to
    // guarantee the reported <=0.5s target.
    virtuosoRef.current?.scrollToIndex({ index: todayIndex, align: "center", behavior: "auto" });
  };
  useEffect(() => {
    const list = virtuosoRef.current;
    if (!grouped || !list || selectedIndex < 0) return;
    // Anchor the selected day, not "about half a screen before it". Centering
    // let Virtuoso put the selected day's header above the visible clip and
    // made the first row look broken; start is also predictable in a long list.
    list.scrollToIndex({ index: selectedIndex, align: "start", behavior: "auto" });
  }, [grouped, selectedIndex, items.length, recenterNonce]);

  const emptyState = (
    <button type="button" className="list-empty" onClick={() => onNew(selectedKey)}>
      <Icon name="leaf" size={24} />{t(searching ? "filterNoResults" : "noEntries", locale)}
    </button>
  );

  function renderEntries(day: TimelineDay) {
    if (!day.entries.length) {
      return (
        // Seed the composer with the day the user actually pointed at: clicking
        // an empty Friday used to open an entry dated today.
        <button type="button" className="list-day-empty" onClick={() => onNew(day.key)}>
          <Icon name="leaf" size={16} />
          <span>{t(searching ? "filterNoResults" : "noEntries", locale)}</span>
          <Icon name="plus" size={13} />
        </button>
      );
    }
      // The timeline presentation is deliberately content-driven: the
    // axis is a growing vine, not an evenly ruled clock. Time still orders
    // the nodes, but visible spacing follows the real gap between entries.
    return (
      <div className="vine-timeline">
        <i className="vine-stem" aria-hidden="true" />
        {[...day.entries].sort((left, right) => (minutesFor(left) ?? -1) - (minutesFor(right) ?? -1)).map((entry, index) => {
          const style = vineNodeStyle(entry, index, index === 0 ? null : minutesFor(day.entries[index - 1]));
          return (
            <div key={entry.id} className="vine-node" style={style}>
              <span className="vine-axis" aria-hidden="true">
                <time>{vineAxisLabel(entry, locale)}</time>
                <i className="vine-knot" />
              </span>
              <i className="vine-branch" aria-hidden="true" />
              <div className="vine-item-host">
                <ItemChip
                  entry={entry}
                  settings={settings}
                  locale={locale}
                  variant="list"
                  className="vine-item"
                  past={isEntryPast(entry, todayKey, now.getHours() * 60 + now.getMinutes())}
                  onOpen={onEdit}
                  onStatusToggle={(target) => onToggle(target.id, target)}
                  onMenu={onEntryMenu}
                />
              </div>
            </div>
          );
        })}
        {day.entries.length > 0 && (
          <button type="button" className="vine-add" onClick={() => onNew(day.key)}>
            <Icon name="plus" size={14} />
            <span>{t("newEntry", locale)}</span>
          </button>
        )}
      </div>
    );
  }

  function renderDay(day: TimelineDay, key?: string) {
    const lunarText = showLunar ? lunarCellLabel(day.date) : "";
    return (
      <article
        key={key}
        className={`list-day${day.selected ? " is-selected" : ""}${isToday(day.date) ? " is-today" : ""}`}
        data-date={day.key}
      >
        <header className="list-day-header">
          <button type="button" className="list-day-date" onClick={() => onSelectDate?.(parseISO(day.key))}>
            <strong>{format(day.date, locale === "zh" ? "M月d日" : "EEE, MMM d", { locale: dateLocale })}</strong>
            {isToday(day.date) && <span>{t("today", locale)}</span>}
            {lunarText && <em>{lunarText}</em>}
          </button>
          <ExpenseBox amount={day.expense} settings={settings} locale={locale} variant="list" />
        </header>
        {renderEntries(day)}
      </article>
    );
  }

  if (mode === "flat") {
    if (!days.some((day) => day.entries.length)) {
      return (
        <div className="agenda-timeline agenda-timeline--flat compact-entry-list">
          <button className="compact-empty" type="button" onClick={() => onNew(selectedKey)}>
            <Icon name="leaf" size={24} />
            <strong>{t(searching ? "filterNoResults" : "noEntries", locale)}</strong>
            <span>{t("newEntry", locale)}</span>
          </button>
        </div>
      );
    }
    return (
      <div className="agenda-timeline agenda-timeline--flat compact-entry-list">
        {days.map((day) => day.entries.length ? renderEntries(day) : null)}
      </div>
    );
  }

  return (
    <div className="agenda-timeline-shell">
    <Virtuoso
      ref={virtuosoRef}
      className="agenda-timeline list-view-scroll"
      data={items}
      firstItemIndex={firstItemIndex}
      computeItemKey={(index, item) => item?.key ?? `row:${index}`}
      initialItemCount={20}
      initialTopMostItemIndex={Math.max(0, selectedIndex)}
      defaultItemHeight={120}
      startReached={onFirstItemReached}
      endReached={onLastItemReached}
      rangeChanged={handleRangeChange}
      itemContent={(_index, item) => {
        // Virtuoso briefly renders phantom measurement rows with no data.
        if (!item) return null;
        if (item.type === "week") {
          const label = weekLabel(item.start, locale);
          return (
            <header className="list-week-header" aria-label={label}>
              <span>{label}</span>
              <em>W{getISOWeek(item.start)}</em>
            </header>
          );
        }
        return renderDay(item.day);
      }}
      components={{ EmptyPlaceholder: () => emptyState }}
    />
      {!todayVisible && todayIndex >= 0 && (
        <button type="button" className="list-today-fab" onClick={scrollToToday}>
          {t("returnToday", locale)}
        </button>
      )}
    </div>
  );
}
