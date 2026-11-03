import { Fragment, useEffect, useRef, useState } from "react";
import { useTouchDevice } from "../hooks/useTouchDevice";
import type { AppView, Locale } from "../domain/entry";
import { INSIGHTS_GROUPS, INSIGHTS_TABS, type InsightsTab } from "./insightsTabs";
import { t, type MessageKey } from "../i18n";
import { formatAccelerator } from "../platform/globalShortcut";
import { Brand } from "./Brand";
import { Icon, type IconName } from "./Icon";
import { SidebarUpdate } from "./SidebarUpdate";

interface SidebarProps {
  locale: Locale;
  activeView: AppView;
  collapsed: boolean;
  dayCount?: number;
  insightsTab?: InsightsTab;
  onViewChange: (view: AppView) => void;
  onDayCountChange?: (days: number) => void;
  onInsightsTabChange?: (tab: InsightsTab) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onNew: () => void;
  onOpenSettings: () => void;
}

const viewItems: Array<{ id: AppView; icon: IconName; label: MessageKey }> = [
  { id: "agenda", icon: "agenda", label: "agenda" },
  { id: "day", icon: "day", label: "day" },
  { id: "week", icon: "week", label: "week" },
  { id: "month", icon: "month", label: "month" },
];

export function Sidebar({
  locale,
  activeView,
  collapsed,
  dayCount = 1,
  insightsTab = "bills",
  onViewChange,
  onDayCountChange,
  onInsightsTabChange,
  onCollapsedChange,
  onNew,
  onOpenSettings,
}: SidebarProps) {
  const touchDevice = useTouchDevice();
  const label = (key: MessageKey) => t(key, locale);
  const keyboardHint = t("keyboardHint", locale);
  const [dayMenuOpen, setDayMenuOpen] = useState(false);
  const dayGroupRef = useRef<HTMLDivElement>(null);
  const minDayCount = 1;
  const maxDayCount = 6;
  // The day menu exists for the collapsed rail only: expanded, the stepper is
  // already on screen and a menu would duplicate it.
  const dayMenuVisible = collapsed && dayMenuOpen && activeView === "day";

  useEffect(() => {
    if (!dayMenuVisible) return;
    const dismiss = (event: Event) => {
      if (dayGroupRef.current?.contains(event.target as Node)) return;
      // The day row is the trigger: its own click decides open or closed.
      if ((event.target as Element | null)?.closest?.(".nav-day-item")) return;
      setDayMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDayMenuOpen(false); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [dayMenuVisible]);

  useEffect(() => { if (!collapsed) setDayMenuOpen(false); }, [collapsed]);
  useEffect(() => { if (activeView !== "day") setDayMenuOpen(false); }, [activeView]);

  return (
    <aside className={collapsed ? "sidebar is-collapsed" : "sidebar"}>
      <span className="sidebar-glow" aria-hidden="true" />
      <div className="sidebar-brand-row">
        <Brand locale={locale} />
        <button
          type="button"
          className="icon-button sidebar-collapse"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? label("sidebarExpand") : label("sidebarCollapse")}
          title={collapsed ? label("sidebarExpand") : label("sidebarCollapse")}
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={17} />
        </button>
      </div>

      <button className="new-entry-button" onClick={onNew} type="button" aria-label={label("newEntry")}>
        <span className="new-entry-icon"><Icon name="plus" size={17} /></span>
        <span>{label("newEntry")}</span>
      </button>

      <nav className="primary-nav" aria-label={t("views", locale)}>
        {viewItems.map((item) => (
          <Fragment key={item.id}>
            <button
              type="button"
              className={(activeView === item.id ? "nav-item is-active" : "nav-item")
                + (item.id === "day" ? " nav-day-item" : "")}
              onClick={() => {
                // Collapsed, the day row behaves like the Dock: selecting the
                // calendar opens the day-range menu instead of a dead click.
                if (item.id === "day" && collapsed) {
                  if (activeView === "day") setDayMenuOpen((open) => !open);
                  else onViewChange("day");
                  return;
                }
                onViewChange(item.id);
              }}
              aria-label={label(item.label)}
              aria-current={activeView === item.id ? "page" : undefined}
              aria-expanded={item.id === "day" && collapsed ? dayMenuVisible : undefined}
              title={label(item.label)}
            >
              <Icon name={item.icon} size={19} />
              {!collapsed && <span>{t(item.label, locale)}</span>}
              {item.id === "day" && collapsed && dayCount > 1 && <b className="nav-day-badge">{dayCount}</b>}
            </button>
            {item.id === "day" && dayMenuVisible && (
              <div className="nav-day-wrap" ref={dayGroupRef}>
                <div className="view-dock-days-menu nav-day-menu" role="menu" aria-label={t("dayCount", locale)}>
                  {Array.from({ length: maxDayCount }, (_, index) => index + 1).map((count) => (
                    <button
                      key={count}
                      type="button"
                      role="menuitemradio"
                      aria-checked={count === dayCount}
                      className={count === dayCount ? "is-selected" : ""}
                      onClick={() => { onDayCountChange?.(count); onViewChange("day"); setDayMenuOpen(false); }}
                    >
                      {count === dayCount ? <Icon name="check" size={12} /> : <i />}
                      {locale === "zh" ? `${count} 天` : count === 1 ? "1 day" : `${count} days`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {item.id === "day" && activeView === "day" && !collapsed && onDayCountChange && (
              <div className="sidebar-day-count" role="group" aria-label={t("dayCount", locale)}>
                <button
                  type="button"
                  className="sidebar-day-step"
                  disabled={dayCount <= minDayCount}
                  onClick={() => onDayCountChange(Math.max(minDayCount, dayCount - 1))}
                  aria-label={t("dayCountDecrease", locale)}
                  title={t("dayCountDecrease", locale)}
                >
                  <Icon name="minus" size={12} />
                </button>
                <span className="sidebar-day-value" aria-live="polite">{dayCount}</span>
                <button
                  type="button"
                  className="sidebar-day-step"
                  disabled={dayCount >= maxDayCount}
                  onClick={() => onDayCountChange(Math.min(maxDayCount, dayCount + 1))}
                  aria-label={t("dayCountIncrease", locale)}
                  title={t("dayCountIncrease", locale)}
                >
                  <Icon name="plus" size={12} />
                </button>
              </div>
            )}
          </Fragment>
        ))}
        {INSIGHTS_GROUPS.map(group => <SidebarInsightsGroup key={group.key} group={group} locale={locale} collapsed={collapsed} activeView={activeView} tab={insightsTab} onViewChange={onViewChange} onTabChange={onInsightsTabChange} />)}
      </nav>

      <div className="sidebar-spacer" />

      <button type="button" className="sidebar-utility" onClick={onOpenSettings} aria-label={label("settings")} title={label("settings")}>
        <Icon name="settings" size={15} />{!collapsed && <span>{t("settings", locale)}</span>}
        {!collapsed && !touchDevice && <kbd>{formatAccelerator("Control+,")}</kbd>}
      </button>
      <SidebarUpdate locale={locale} collapsed={collapsed} />
      {!collapsed && !touchDevice && <p className="sidebar-hint"><Icon name="command" size={14} /> {keyboardHint}</p>}
    </aside>
  );
}

function SidebarInsightsGroup({ group, locale, collapsed, activeView, tab, onViewChange, onTabChange }: {
  group: typeof INSIGHTS_GROUPS[number]; locale: Locale; collapsed: boolean; activeView: AppView; tab: InsightsTab;
  onViewChange: (view: AppView) => void; onTabChange?: (tab: InsightsTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<InsightsTab>(group.tabs[0]);
  const contains = group.tabs.some(value => value === tab);
  const active = activeView === "insights" && contains;
  if (contains) last.current = tab;
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", dismiss); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", key); };
  }, [open]);
  useEffect(() => { if (!active || !collapsed) setOpen(false); }, [active, collapsed]);
  const choose = (value: InsightsTab) => { onTabChange?.(value); onViewChange("insights"); setOpen(false); };
  const label = t(group.label, locale);
  const tabs = INSIGHTS_TABS.filter(item => group.tabs.some(value => value === item.tab));
  const controls = tabs.map(item => <button key={item.tab} type="button" role={collapsed ? "menuitemradio" : undefined} aria-checked={collapsed ? active && item.tab === tab : undefined} aria-pressed={!collapsed ? active && item.tab === tab : undefined} className={item.tab === tab && active ? (collapsed ? "is-selected" : "is-active") : ""} onClick={() => choose(item.tab)}><Icon name={item.icon} size={13} /><span>{item.tab === "map" ? (locale === "zh" ? "足迹" : "Footprints") : t(item.label, locale)}</span></button>);
  return <div className="sidebar-insights-group" ref={ref}>
    <button type="button" className={`nav-item nav-insights-item${active ? " is-active" : ""}`} aria-label={label} title={label} aria-current={active ? "page" : undefined} aria-expanded={collapsed ? open : active} onClick={() => { if (collapsed && active) setOpen(value => !value); else choose(last.current); }}><Icon name={group.icon} size={19} />{!collapsed && <span>{label}</span>}</button>
    {collapsed && open && <div className="nav-day-wrap"><div className="view-dock-days-menu nav-day-menu" role="menu" aria-label={label}>{controls}</div></div>}
    {!collapsed && active && <div className="sidebar-insights-switch" role="group" aria-label={label}>{controls}</div>}
  </div>;
}
