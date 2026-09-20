import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import type { ChronoEonSettings, Entry, Locale } from "../domain/entry";
import { getLunarInfo, lunarCellLabel } from "../domain/lunar";
import { isEntryPast } from "@chronoeon/domain";
import { t } from "../i18n";
import { ExpenseBox } from "./ExpenseBox";
import { Icon } from "./Icon";
import { ItemChip } from "./ItemChip";
import { useModalDismiss } from "./modalLayer";

interface MonthDayPeekProps {
  /** The cell the badge was clicked in; the panel is anchored over it. */
  anchor: DOMRect;
  date: Date;
  dateKey: string;
  entries: Entry[];
  expense: number;
  settings: ChronoEonSettings;
  locale: Locale;
  showLunar: boolean;
  onClose: () => void;
  onToggle: (id: string, entry?: Entry) => void;
  onEdit: (entry: Entry) => void;
  onEntryMenu?: (entry: Entry, event: React.MouseEvent) => void;
  onNewAt?: (date: string) => void;
  onOpenDay: () => void;
}

const MARGIN = 10;
const MIN_WIDTH = 232;

/** The items omitted from a month cell, or a day opened with the keyboard.
 * Reuse ItemChip and its actions; overflow callers pass only truly hidden items. */
export function MonthDayPeek({
  anchor,
  date,
  dateKey,
  entries,
  expense,
  settings,
  locale,
  showLunar,
  onClose,
  onToggle,
  onEdit,
  onEntryMenu,
  onNewAt,
  onOpenDay,
}: MonthDayPeekProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);

  // Own the next Escape through the shared modal bus rather than a private
  // window listener, so a peek opened over an open dialog still closes exactly
  // one layer per press.
  useModalDismiss((event) => {
    event.preventDefault();
    onClose();
  });

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    // Capture phase: a chip inside the month grid must not swallow the press.
    window.addEventListener("pointerdown", dismiss, true);
    return () => window.removeEventListener("pointerdown", dismiss, true);
  }, [onClose]);

  useLayoutEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const width = Math.max(MIN_WIDTH, Math.min(anchor.width + 40, 320));
    const height = node.getBoundingClientRect().height;
    const centre = anchor.left + anchor.width / 2;
    // Clamp to the calendar itself: the viewport's left edge includes the
    // sidebar, so a first-column peek could otherwise cover navigation.
    const host = node.closest(".month-panel, .month-layout, .day-view, .content-inner--calendar")?.getBoundingClientRect();
    const left = Math.max(
      (host?.left ?? 0) + MARGIN,
      Math.min(centre - width / 2, (host?.right ?? window.innerWidth) - width - MARGIN),
    );
    const dock = node.closest(".main-shell")?.querySelector(".view-dock")?.getBoundingClientRect();
    const lowerBound = dock ? dock.top - MARGIN : window.innerHeight - MARGIN;
    // Prefer covering the cell; flip up, then clamp, so it never opens
    // off-screen or under the persistent dock.
    let top = anchor.top - 6;
    if (top + height + MARGIN > lowerBound) top = anchor.bottom - height + 6;
    top = Math.max(MARGIN, Math.min(top, lowerBound - height));
    setPosition({ left, top, width });
  }, [anchor.bottom, anchor.height, anchor.left, anchor.top, anchor.width, entries.length]);

  // Take focus once, after the click that opened the panel has settled — a
  // focus() inside the positioning effect above runs before the browser hands
  // focus back to the badge, so it would be immediately undone.
  useEffect(() => {
    const frame = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  const dateLocale = locale === "zh" ? zhCN : enUS;
  const now = new Date();
  const todayKey = format(now, "yyyy-MM-dd");
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const lunarInfo = showLunar ? getLunarInfo(date) : null;
  const heading = format(date, locale === "zh" ? "M月d日 EEEE" : "EEEE, MMMM d", { locale: dateLocale });

  return (
    <div
      ref={panelRef}
      className="month-peek"
      role="dialog"
      aria-modal="false"
      aria-label={heading}
      tabIndex={-1}
      style={position
        ? { left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px` }
        // First paint measures the natural height off-screen, so the flip
        // decision above is made against the real size instead of a guess.
        : { left: "-9999px", top: "0px", width: `${MIN_WIDTH}px`, visibility: "hidden" }}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="month-peek-head">
        <div>
          <strong>{heading}</strong>
          {lunarInfo && <em>{lunarCellLabel(date)}</em>}
        </div>
        <button type="button" className="month-peek-close" aria-label={t("close", locale)} title={t("close", locale)} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </header>

      {expense > 0 && <ExpenseBox amount={expense} settings={settings} locale={locale} variant="list" />}

      {entries.length ? (
        <div className="month-peek-items">
          {entries.map((entry) => (
            <ItemChip
              key={entry.id}
              entry={entry}
              settings={settings}
              locale={locale}
              variant="month"
              past={isEntryPast(entry, todayKey, nowMinutes)}
              onOpen={(target) => { onClose(); onEdit(target); }}
              onStatusToggle={(target) => onToggle(target.id, target)}
              onMenu={onEntryMenu}
            />
          ))}
        </div>
      ) : (
        <p className="month-peek-empty">{t("noEntries", locale)}</p>
      )}

      <footer className="month-peek-actions">
        {onNewAt && (
          <button type="button" onClick={() => { onClose(); onNewAt(dateKey); }}>
            <Icon name="plus" size={13} />{t("newEntry", locale)}
          </button>
        )}
        <button type="button" onClick={() => { onClose(); onOpenDay(); }}>
          {t("openDay", locale)}<Icon name="chevron-right" size={13} />
        </button>
      </footer>
    </div>
  );
}
