import { Fragment, useEffect, useRef, useState } from "react";
import { useTouchDevice } from "../hooks/useTouchDevice";
import type { AppView, Locale } from "../domain/entry";
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
  onViewChange: (view: AppView) => void;
  onDayCountChange?: (days: number) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onNew: () => void;
  onCompact: () => void;
  onOpenSettings: () => void;
}

const viewItems: Array<{ id: AppView; icon: IconName; label: MessageKey }> = [
  { id: "agenda", icon: "agenda", label: "agenda" },
  { id: "day", icon: "day", label: "day" },
  { id: "week", icon: "week", label: "week" },
  { id: "month", icon: "month", label: "month" },
  { id: "ideas", icon: "idea", label: "ideas" },
  { id: "insights", icon: "insights", label: "insights" },
];

export function Sidebar({
  locale,
  activeView,
  collapsed,
  dayCount = 1,
  onViewChange,
  onDayCountChange,
  onCollapsedChange,
  onNew,
  onCompact,
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
              className={(activeView === item.id ? "nav-item is-active" : "nav-item") + (item.id === "day" ? " nav-day-item" : "")}
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
              {item.id === "ideas" && !collapsed && <span className="nav-dot" />}
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
      </nav>

      <div className="sidebar-spacer" />

      <button type="button" className="sidebar-utility" onClick={onCompact} aria-label={label("miniWindow")} title={label("miniWindow")}>
        <Icon name="pin" size={15} />{!collapsed && <span>{t("miniWindow", locale)}</span>}
      </button>
      <button type="button" className="sidebar-utility" onClick={onOpenSettings} aria-label={label("settings")} title={label("settings")}>
        <Icon name="settings" size={15} />{!collapsed && <span>{t("settings", locale)}</span>}
        {!collapsed && !touchDevice && <kbd>{formatAccelerator("Control+,")}</kbd>}
      </button>
      <SidebarUpdate locale={locale} collapsed={collapsed} />
      {!collapsed && !touchDevice && <p className="sidebar-hint"><Icon name="command" size={14} /> {keyboardHint}</p>}
    </aside>
  );
}
