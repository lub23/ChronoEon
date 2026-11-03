import { MotionPresence } from "./MotionPresence";
import { INSIGHTS_GROUPS, INSIGHTS_TABS, insightsTabIcon, type InsightsTab } from "./insightsTabs";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  /** Insights content type; the Dock owns this switch so no extra toolbar is needed. */
  insightsTab?: InsightsTab;
  onViewChange: (view: AppView) => void;
  onDayCountChange: (days: number) => void;
  onInsightsTabChange?: (tab: InsightsTab) => void;
  onTimer: () => void;
  onQuickNote: () => void;
  /** Floating content anchored above the dock's timer button (the live pill). */
  children?: ReactNode;
}

const FULL_DAY_OPTIONS = [1, 2, 3, 4, 5, 6];
/** A single centered add mark. */
function QuickNoteGlyph() {
  return (
    <svg className="quick-note-glyph" viewBox="0 0 32 32" fill="none" role="presentation" aria-hidden="true" focusable="false">
      <path className="quick-note-plus" d="M16 6v20M6 16h20" />
    </svg>
  );
}

/** Three stacked leaves under an icon: this button holds several views. */
function StackMark({ open }: { open: boolean }) {
  return <i className={open ? "view-dock-stack-mark is-open" : "view-dock-stack-mark"} aria-hidden="true"><b /><b /><b /></i>;
}

/**
 * Icon-only glass Dock. Day/week share the day-range menu; Month is adjacent.
 * The quick-note button sits between the calendar and Insights; Insights
 * carries every statistics surface (bills, time, assets, ideas, map) in one
 * menu and shows the icon of the surface currently open.
 */
export function ViewDock({
  locale,
  activeView,
  calendarView = "day",
  timerActive = false,
  dayCount,
  insightsTab = "bills",
  onViewChange,
  onDayCountChange,
  onInsightsTabChange,
  onTimer,
  onQuickNote,
  children,
}: ViewDockProps) {
  const [switchOpen, setSwitchOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState<"stats" | "things" | null>(null);
  const lastStats = useRef<InsightsTab>("bills");
  const lastThings = useRef<InsightsTab>("items");
  if (insightsTab === "items" || insightsTab === "ideas") lastThings.current = insightsTab; else lastStats.current = insightsTab;
  const switchGroupRef = useRef<HTMLDivElement>(null);
  const insightsGroupRef = useRef<HTMLDivElement>(null);
  const calendarActive = activeView === "day" || activeView === "week";
  const insightsActive = activeView === "insights";
  const calendarIcon: IconName = calendarView === "week" ? "week" : "day";
  const calendarLabel = calendarView === "week" ? t("week", locale) : t("day", locale);
  const dayOptions = FULL_DAY_OPTIONS;

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
  useEffect(() => {
    if (!insightsOpen) return;
    const dismiss = (event: Event) => {
      if (insightsGroupRef.current?.contains(event.target as Node)) return;
      if (event.target instanceof Element && event.target.closest(".glass-select-popup")) return;
      setInsightsOpen(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setInsightsOpen(null); } };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", onKey); };
  }, [insightsOpen]);
  useEffect(() => { if (!insightsActive) setInsightsOpen(null); }, [insightsActive]);
  return (
    <nav className="view-dock is-icon-only" aria-label={t("views", locale)}>
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
            className={calendarActive ? "view-dock-item has-stack is-active" : "view-dock-item has-stack"}
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
            <StackMark open={switchOpen} />
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
              <>
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
              </>
            </div>
          )}</MotionPresence>
        </div>

        <button
          className={activeView === "month" ? "view-dock-item is-active" : "view-dock-item"}
          type="button"
          onClick={() => { setSwitchOpen(false); onViewChange("month"); }}
          aria-label={t("month", locale)} aria-current={activeView === "month" ? "page" : undefined} title={t("month", locale)}
        ><Icon name="month" size={18} /></button>

        <button
          className="view-dock-item view-dock-quicknote"
          type="button"
          onClick={onQuickNote}
          aria-label={t("quickNote", locale)}
          title={t("quickNote", locale)}
        >
          <QuickNoteGlyph />
        </button>

        <div className="view-dock-groups" ref={insightsGroupRef}>
          {INSIGHTS_GROUPS.map(({ key: group, label: groupLabel }) => {
            const tabs = INSIGHTS_TABS.filter(item => group === "things" ? item.tab === "items" || item.tab === "ideas" : item.tab !== "items" && item.tab !== "ideas");
            const active = insightsActive && tabs.some(item => item.tab === insightsTab);
            const current = group === "stats" ? lastStats.current : lastThings.current;
            const label = t(groupLabel, locale);
            const open = insightsOpen === group;
            return <div className="view-dock-day-group" key={group}>
              <button type="button" className={active ? "view-dock-item has-stack is-active" : "view-dock-item has-stack"} aria-label={label} title={label} aria-current={active ? "page" : undefined} aria-expanded={open} onClick={() => {
                if (active) setInsightsOpen(open ? null : group);
                else { onInsightsTabChange?.(current); onViewChange("insights"); setInsightsOpen(null); }
              }}><Icon name={insightsTabIcon(current)} size={18} /><StackMark open={open} /></button>
              <MotionPresence>{open && <div className="view-dock-days-menu view-dock-insights-menu" role="menu" aria-label={label}>{tabs.map(item => <button key={item.tab} type="button" role="menuitemradio" aria-checked={active && insightsTab === item.tab} className={active && insightsTab === item.tab ? "is-selected" : ""} onClick={() => { onInsightsTabChange?.(item.tab); onViewChange("insights"); setInsightsOpen(null); }}><Icon name={item.icon} size={12} />{item.tab === "map" ? (locale === "zh" ? "足迹" : "Footprints") : t(item.label, locale)}</button>)}</div>}</MotionPresence>
            </div>;
          })}
        </div>
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
      {children}
    </nav>
  );
}
