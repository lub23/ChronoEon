import { MotionPresence } from "./MotionPresence";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { AppView, Locale } from "../domain/entry";
import { t } from "../i18n";
import { Icon, type IconName } from "./Icon";

interface ViewDockProps {
  locale: Locale;
  activeView: AppView;
  /** The last day/week choice. Month has its own adjacent button. */
  calendarView?: "day" | "week";
  timerActive?: boolean;
  /** Visible civil-day columns in Day view, 1-6. */
  dayCount: number;
  /**
   * Mini window: the same dock minus the week, month, 4/5/6-day and
   * statistics entries, plus the "restore the normal window" action.
   */
  mini?: boolean;
  onViewChange: (view: AppView) => void;
  onDayCountChange: (days: number) => void;
  /** Mini only: the shared filter trigger occupies the old New slot. */
  filterControl?: ReactNode;
  onTimer: () => void;
  onQuickNote: () => void;
  onRestore?: () => void;
  /** Floating content anchored above the dock's timer button (the live pill). */
  children?: ReactNode;
}

type PlainView = "agenda" | "ideas" | "insights";

const dockItems: Array<{ view: PlainView; icon: IconName; label: "agenda" | "ideas" | "insights" }> = [
  { view: "ideas", icon: "idea", label: "ideas" },
  { view: "insights", icon: "insights", label: "insights" },
];

const FULL_DAY_OPTIONS = [1, 2, 3, 4, 5, 6];
const MINI_DAY_OPTIONS = [1, 2, 3];
/** A single centered add mark. */
function QuickNoteGlyph() {
  return (
    <svg className="quick-note-glyph" viewBox="0 0 32 32" fill="none" role="presentation" aria-hidden="true" focusable="false">
      <path className="quick-note-plus" d="M16 6v20M6 16h20" />
    </svg>
  );
}

/**
 * Icon-only glass Dock. Day/week share the day-range menu; Month is adjacent.
 * The quick-note button sits beside Ideas: click it to type.
 */
export function ViewDock({
  locale,
  activeView,
  calendarView = "day",
  timerActive = false,
  dayCount,
  mini = false,
  onViewChange,
  onDayCountChange,
  filterControl,
  onTimer,
  onQuickNote,
  onRestore,
  children,
}: ViewDockProps) {
  const [switchOpen, setSwitchOpen] = useState(false);
  const switchGroupRef = useRef<HTMLDivElement>(null);
  const calendarActive = activeView === "day" || activeView === "week";
  const calendarIcon: IconName = calendarView === "week" ? "week" : "day";
  const calendarLabel = calendarView === "week" ? t("week", locale) : t("day", locale);
  const dayOptions = mini ? MINI_DAY_OPTIONS : FULL_DAY_OPTIONS;

  useEffect(() => {
    if (!switchOpen) return;
    const dismiss = (event: Event) => {
      if (switchGroupRef.current?.contains(event.target as Node)) return;
      if (event.target instanceof Element && event.target.closest(".glass-picker-popup, .glass-select-popup")) return;
      setSwitchOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setSwitchOpen(false); } };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [switchOpen]);

  useEffect(() => { if (!calendarActive) setSwitchOpen(false); }, [calendarActive]);
  return (
    <nav className={`view-dock is-icon-only${mini ? " is-mini" : ""}`} aria-label={t("views", locale)}>
      {mini && filterControl && <>{filterControl}<span className="view-dock-divider" aria-hidden="true" /></>}
      <div className="view-dock-views">
        <button
          className={activeView === "agenda" ? "view-dock-item is-active" : "view-dock-item"}
          type="button"
          onClick={() => { setSwitchOpen(false); onViewChange("agenda"); }}
          aria-label={t("agenda", locale)}
          aria-current={activeView === "agenda" ? "page" : undefined}
          title={t("agenda", locale)}
        >
          <Icon name="agenda" size={18} />
        </button>

        <div className="view-dock-day-group" ref={switchGroupRef}>
          <button
            className={calendarActive ? "view-dock-item is-active" : "view-dock-item"}
            type="button"
            onClick={() => {
              if (calendarActive) setSwitchOpen((open) => !open);
              else onViewChange(calendarView);
            }}
            aria-label={activeView === "day" && dayCount > 1 ? `${calendarLabel} · ${dayCount}` : calendarLabel}
            aria-current={calendarActive ? "page" : undefined}
            aria-expanded={calendarActive ? switchOpen : undefined}
            title={activeView === "day" && dayCount > 1 ? `${calendarLabel} · ${dayCount}` : calendarLabel}
          >
            <Icon name={calendarIcon} size={18} />
            {activeView === "day" && dayCount > 1 && <b className="view-dock-day-count">{dayCount}</b>}
          </button>
          <MotionPresence>{switchOpen && (
            <div className="view-dock-days-menu" role="menu" aria-label={t("dayCount", locale)}>
              {dayOptions.map((count) => (
                <button
                  key={count}
                  type="button"
                  role="menuitemradio"
                  aria-checked={activeView === "day" && count === dayCount}
                  className={activeView === "day" && count === dayCount ? "is-selected" : ""}
                  onClick={() => { onDayCountChange(count); onViewChange("day"); setSwitchOpen(false); }}
                >
                  {activeView === "day" && count === dayCount ? <Icon name="check" size={12} /> : <i />}
                  {locale === "zh" ? `${count} 天` : count === 1 ? "1 day" : `${count} days`}
                </button>
              ))}
              {!mini && <>
                <span className="view-dock-menu-separator" aria-hidden="true" />
                {([["week", "week", "week"]] as const).map(([view, icon, label]) => (
                  <button
                    key={view}
                    type="button"
                    role="menuitemradio"
                    aria-checked={activeView === view}
                    className={activeView === view ? "is-selected" : ""}
                    onClick={() => { onViewChange(view); setSwitchOpen(false); }}
                  >
                    {activeView === view ? <Icon name="check" size={12} /> : <i />}
                    <Icon name={icon} size={12} />
                    {t(label, locale)}
                  </button>
                ))}
              </>}
            </div>
          )}</MotionPresence>
        </div>

        {!mini && <button
          className={activeView === "month" ? "view-dock-item is-active" : "view-dock-item"}
          type="button"
          onClick={() => { setSwitchOpen(false); onViewChange("month"); }}
          aria-label={t("month", locale)} aria-current={activeView === "month" ? "page" : undefined} title={t("month", locale)}
        ><Icon name="month" size={18} /></button>}

        <button
          className="view-dock-item view-dock-quicknote"
          type="button"
          onClick={onQuickNote}
          aria-label={t("quickNote", locale)}
          title={t("quickNote", locale)}
        >
          <QuickNoteGlyph />
        </button>

        {dockItems.filter((item) => !(mini && item.view === "insights")).map((item) => (
          <button
            key={item.view}
            className={activeView === item.view ? "view-dock-item is-active" : "view-dock-item"}
            type="button"
            onClick={() => { setSwitchOpen(false); onViewChange(item.view); }}
            aria-label={t(item.label, locale)}
            aria-current={activeView === item.view ? "page" : undefined}
            title={t(item.label, locale)}
          >
            <Icon name={item.icon} size={18} />
          </button>
        ))}
      </div>
      <span className="view-dock-divider" aria-hidden="true" />
      <button
        className={timerActive ? "view-dock-action is-active" : "view-dock-action"}
        type="button"
        onClick={onTimer}
        aria-label={t("timer", locale)}
        aria-pressed={timerActive}
        title={t("timer", locale)}
      >
        <Icon name="timer" size={17} />
      </button>
      {mini && onRestore && (
        <button
          className="view-dock-action"
          type="button"
          onClick={onRestore}
          aria-label={t("restore", locale)}
          title={t("restore", locale)}
        >
          <Icon name="restore" size={17} />
        </button>
      )}
      {children}
    </nav>
  );
}
