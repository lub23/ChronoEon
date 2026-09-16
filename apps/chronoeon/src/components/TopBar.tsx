import { useEffect, useState, type ReactNode } from "react";
import { useRef } from "react";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import { addDays, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import type { AppView, ChronoEonSettings, Locale } from "../domain/entry";
import { performDesktopWindowAction, setDesktopMinimumWidth, startDesktopDrag } from "../platform/desktop";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { GlassDatePicker } from "./GlassDateTimePicker";
import { WindowControls } from "./WindowControls";

interface TopBarProps {
  locale: Locale;
  view: AppView;
  selectedDate: Date;
  weekStartsOn: ChronoEonSettings["firstDay"];
  /** Flexible Day range; Week remains fixed at seven. */
  dayCount?: number;
  filterControl?: ReactNode;
  onNavigate: (direction: -1 | 0 | 1) => void;
  onJumpDate: (date: Date) => void;
  onMobileMenu: () => void;
  /** True while a write is in flight, so the disk never looks frozen. */
  saving?: boolean;
  /** Desktop has undecorated-window chrome; phones use system controls. */
  showWindowControls?: boolean;
  /** Mini window: no sidebar toggle, no maximize, everything else stays. */
  mini?: boolean;
}

function headingFor(view: AppView, selectedDate: Date, locale: Locale, weekStartsOn: ChronoEonSettings["firstDay"], dayCount = 1): string {
  const dateLocale = locale === "zh" ? zhCN : enUS;
  if (view === "month") return format(selectedDate, locale === "zh" ? "yyyy年M月" : "MMM yyyy", { locale: dateLocale });
  if (view === "week") {
    const start = startOfWeek(selectedDate, { weekStartsOn });
    const end = addDays(start, 6);
    return locale === "zh"
      ? `${format(start, "M月d日", { locale: dateLocale })} – ${format(end, "M月d日", { locale: dateLocale })}`
      : `${format(start, "MMM d", { locale: dateLocale })} – ${format(end, "MMM d", { locale: dateLocale })}`;
  }
  if (view === "day") {
    if (dayCount > 1) {
      const end = addDays(selectedDate, dayCount - 1);
      return locale === "zh"
        ? `${format(selectedDate, "M\u6708d\u65e5", { locale: dateLocale })} \u2013 ${format(end, "M\u6708d\u65e5", { locale: dateLocale })}`
        : `${format(selectedDate, "MMM d", { locale: dateLocale })} \u2013 ${format(end, "MMM d", { locale: dateLocale })}`;
    }
    return format(selectedDate, locale === "zh" ? "M\u6708d\u65e5 EEE" : "EEE, MMM d", { locale: dateLocale });
  }
  return format(selectedDate, locale === "zh" ? "M月d日 EEE" : "EEE, MMM d", { locale: dateLocale });
}

export function highlightedRange(view: AppView, selectedDate: Date, weekStartsOn: ChronoEonSettings["firstDay"], dayCount = 1) {
  const key = (date: Date) => format(date, "yyyy-MM-dd");
  if (view === "month") return { start: key(startOfMonth(selectedDate)), end: key(endOfMonth(selectedDate)) };
  if (view === "week") {
    const start = startOfWeek(selectedDate, { weekStartsOn });
    return { start: key(start), end: key(addDays(start, 6)) };
  }
  if (view === "day") return { start: key(selectedDate), end: key(addDays(selectedDate, Math.max(1, dayCount) - 1)) };
  return { start: key(selectedDate), end: key(selectedDate) };
}

/** Include real drawer margins/gaps, not just button widths: otherwise the
 * last native button can still be clipped at the enforced minimum size. */
export function minimumTitlebarWidth(bar: HTMLElement): number {
  const px = (value: string) => Number.parseFloat(value) || 0;
  const style = getComputedStyle(bar);
  const width = [".date-navigation", ".topbar-actions"].reduce((sum, selector) => sum + (bar.querySelector(selector)?.getBoundingClientRect().width ?? 0), 0);
  // The mini window has no drawer button at all, so its width is simply absent.
  const menu = bar.querySelector<HTMLElement>(".topbar-mobile-brand");
  const button = menu?.querySelector("button") ?? null;
  const menuWidth = menu ? (menu.getBoundingClientRect().width || (button ? px(getComputedStyle(button).width) : 0)) : 0;
  const menuMargin = menu ? px(getComputedStyle(menu).marginLeft) + px(getComputedStyle(menu).marginRight) : 0;
  return Math.ceil(width + menuWidth + menuMargin
    + 2 * px(style.columnGap) + px(style.paddingLeft) + px(style.paddingRight));
}

export function TopBar(props: TopBarProps) {
  const { locale, view, selectedDate } = props;
  const heading = headingFor(view, selectedDate, locale, props.weekStartsOn, props.dayCount);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpAnchor, setJumpAnchor] = useState({ left: 0, top: 0 });
  const barRef = useRef<HTMLElement>(null);
  const jumpAnchorRef = useRef<HTMLButtonElement | null>(null);
  const jumpPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!jumpOpen) return;
    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest(".glass-picker-popup")) return;
      if (jumpAnchorRef.current?.contains(target) || jumpPopoverRef.current?.contains(target)) return;
      setJumpOpen(false);
    }
    const close = () => setJumpOpen(false);
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("resize", close);
    };
  }, [jumpOpen]);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || props.showWindowControls === false || typeof ResizeObserver === "undefined") return;
    const measure = () => { void setDesktopMinimumWidth(minimumTitlebarWidth(bar)).catch(() => undefined); };
    const observer = new ResizeObserver(measure);
    observer.observe(bar); measure();
    return () => observer.disconnect();
  }, [heading, props.showWindowControls]);

  const beginWindowDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, input, label, kbd, .window-controls")) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
    event.preventDefault();
    void startDesktopDrag();
  };

  return (
    <header ref={barRef} className={props.mini ? "topbar is-mini" : "topbar"} onPointerDown={beginWindowDrag} onDoubleClick={(event) => {
      if ((event.target as HTMLElement).closest("button, input, label")) return;
      if (props.mini) return;
      if (typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
      void performDesktopWindowAction("toggle-maximize");
    }}>
      {!props.mini && (
        <div className="topbar-mobile-brand">
          <button className="icon-button" type="button" onClick={props.onMobileMenu} aria-label={t("views", locale)}><Icon name="menu" /></button>
        </div>
      )}

      <div className="date-navigation">
        <button className="icon-button" type="button" onClick={() => props.onNavigate(-1)} aria-label={t("previous", locale)} title={t("previous", locale)}><Icon name="chevron-left" /></button>
        <h2 className="date-title" title={t("jumpToDate", locale)}>
          <button
            ref={jumpAnchorRef}
            className={`jump-date-trigger date-title-button${jumpOpen ? " is-active" : ""}`}
            type="button"
            onClick={() => {
              const rect = jumpAnchorRef.current?.getBoundingClientRect();
              if (rect) {
                setJumpAnchor({
                  left: Math.max(8, Math.min(rect.left + rect.width / 2 - 135, window.innerWidth - 286)),
                  top: rect.bottom + 9,
                });
              }
              setJumpOpen((current) => !current);
            }}
            aria-label={t("jumpToDate", locale)}
            aria-expanded={jumpOpen}
            aria-haspopup="dialog"
          >
            {heading}
          </button>
        </h2>
        <button className="icon-button topbar-today-button" type="button" onClick={() => props.onNavigate(0)} aria-label={t("today", locale)} title={t("today", locale)}><Icon name="target" size={15} /></button>
        <button className="icon-button" type="button" onClick={() => props.onNavigate(1)} aria-label={t("next", locale)} title={t("next", locale)}><Icon name="chevron-right" /></button>
        <MotionPresence>{jumpOpen && createPortal(
          <div className="jump-date-pop" ref={jumpPopoverRef} role="dialog" aria-label={t("jumpToDate", locale)} style={{ left: jumpAnchor.left, top: jumpAnchor.top }}>
            <header>
              <strong>{t("jumpToDate", locale)}</strong>
              <small>{locale === "zh"
                ? view === "month" ? "当前月份已高亮，跳到所在月份" : view === "week" ? "当前周已高亮，跳到所在周" : view === "day" ? "当前 n 天已高亮，跳到所在范围" : "选择后进入当天"
                : view === "month" ? "Current month highlighted; jump by month" : view === "week" ? "Current week highlighted; jump by week" : view === "day" ? "Current n-day range highlighted" : "Pick a day"}</small>
            </header>
            <GlassDatePicker
              inline
              value={format(selectedDate, "yyyy-MM-dd")}
              ariaLabel={t("jumpToDate", locale)}
              locale={locale}
              clearable={false}
              weekStartsOn={props.weekStartsOn}
              highlight={highlightedRange(view, selectedDate, props.weekStartsOn, props.dayCount)}
              onChange={(value) => {
                if (!value) return;
                const [year, month, day] = value.split("-").map(Number);
                props.onJumpDate(new Date(year, month - 1, day));
                setJumpOpen(false);
              }}
            />
          </div>,
          document.body,
        )}</MotionPresence>
      </div>

      <span className="topbar-drag-space" data-tauri-drag-region="true" aria-hidden="true" />
      <div className="topbar-actions">
        {props.saving && (
          <span className="topbar-saving" role="status" aria-live="polite" title={t("importExportBusy", locale)}>
            <i aria-hidden="true" />{t("importExportBusy", locale)}
          </span>
        )}
        {!props.mini && props.filterControl}
        {props.showWindowControls !== false && <WindowControls locale={locale} mini={props.mini} />}
      </div>
    </header>
  );
}
