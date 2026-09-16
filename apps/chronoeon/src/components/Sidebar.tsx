import { Fragment } from "react";
import { useTouchDevice } from "../hooks/useTouchDevice";
import type { AppView, Locale } from "../domain/entry";
import { t, type MessageKey } from "../i18n";
import { formatAccelerator } from "../platform/globalShortcut";
import { Brand } from "./Brand";
import { Icon, type IconName } from "./Icon";

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
  onChat: () => void;
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
  onChat,
  onOpenSettings,
}: SidebarProps) {
  const touchDevice = useTouchDevice();
  const label = (key: MessageKey) => t(key, locale);
  const keyboardHint = t("keyboardHint", locale);

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
              className={activeView === item.id ? "nav-item is-active" : "nav-item"}
              onClick={() => onViewChange(item.id)}
              aria-label={label(item.label)}
              aria-current={activeView === item.id ? "page" : undefined}
              title={label(item.label)}
            >
              <Icon name={item.icon} size={19} />
              {!collapsed && <span>{t(item.label, locale)}</span>}
              {item.id === "ideas" && !collapsed && <span className="nav-dot" />}
            </button>
            {item.id === "day" && activeView === "day" && !collapsed && onDayCountChange && (
              <label className="sidebar-day-count">
                <span>{t("dayCount", locale)}</span>
                <select value={dayCount} onChange={(event) => onDayCountChange(Number(event.target.value))} aria-label={t("dayCount", locale)}>
                  {[1, 2, 3, 4, 5, 6].map((days) => (
                    <option key={days} value={days}>{locale === "zh" ? `${days} 天` : days === 1 ? "1 day" : `${days} days`}</option>
                  ))}
                </select>
              </label>
            )}
          </Fragment>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <button type="button" className="sidebar-utility" onClick={onCompact} aria-label={label("miniWindow")} title={label("miniWindow")}>
        <Icon name="pin" size={15} />{!collapsed && <span>{t("miniWindow", locale)}</span>}
      </button>
      <button type="button" className="sidebar-utility" onClick={onChat} aria-label={label("aiChatTitle")} title={label("aiChatTitle")}>
        <Icon name="sparkle" size={15} />{!collapsed && <span>{t("aiChatTitle", locale)}</span>}
      </button>
      <button type="button" className="sidebar-utility" onClick={onOpenSettings} aria-label={label("settings")} title={label("settings")}>
        <Icon name="settings" size={15} />{!collapsed && <span>{t("settings", locale)}</span>}
        {!collapsed && !touchDevice && <kbd>{formatAccelerator("Control+,")}</kbd>}
      </button>
      {!collapsed && !touchDevice && <p className="sidebar-hint"><Icon name="command" size={14} /> {keyboardHint}</p>}
    </aside>
  );
}
