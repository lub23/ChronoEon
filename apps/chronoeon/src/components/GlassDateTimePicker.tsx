import { TimeDial } from "./TimeDial";
import { useTouchDevice } from "../hooks/useTouchDevice";
import { useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import type { ChronoEonSettings, Locale } from "../domain/entry";
import { registerModalDismiss } from "./modalLayer";
import { Icon } from "./Icon";

interface PickerPosition {
  left: number;
  top: number;
  width: number;
  above: boolean;
}

function pickerStyle(position: PickerPosition): CSSProperties {
  return {
    "--popup-left": `${position.left}px`,
    "--popup-top": `${position.top}px`,
    "--popup-width": `${position.width}px`,
  } as CSSProperties;
}

function mediaMatches(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function usePickerSurface(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  popupRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
  options: { preferredWidth?: number; align?: "start" | "end" } = {},
) {
  const [position, setPosition] = useState<PickerPosition>({ left: 0, top: 0, width: options.preferredWidth ?? 220, above: false });
  const [placed, setPlaced] = useState(false);

  const place = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const preferredWidth = options.preferredWidth ?? 262;
    const width = Math.min(preferredWidth, window.innerWidth - 16);
    const height = Math.min(popupRef.current?.offsetHeight || 318, window.innerHeight - 16);
    const belowSpace = window.innerHeight - rect.bottom - 8;
    const above = belowSpace < height && rect.top > window.innerHeight / 2;
    const top = Math.max(8, Math.min(above ? rect.top - height - 8 : rect.bottom + 8, window.innerHeight - height - 8));
    const naturalLeft = options.align === "end" ? rect.right - width : rect.left;
    const left = Math.max(8, Math.min(naturalLeft, window.innerWidth - width - 8));
    setPosition({ left, top, width, above });
    setPlaced(true);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, options.align, options.preferredWidth, position.width]);

  useEffect(() => {
    if (!open) setPlaced(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [onClose, open, options.align, options.preferredWidth]);

  useEffect(() => {
    if (!open) return;
    return registerModalDismiss((event) => {
      event.preventDefault();
      onClose();
    });
  }, [onClose, open]);

  return { position, placed };
}

interface GlassDatePickerProps {
  value?: string;
  onChange: (value?: string) => void;
  ariaLabel: string;
  /** Empty-state hint. The accessible name still comes from ariaLabel. */
  placeholder?: string;
  locale: Locale;
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** The inclusive civil range currently shown by the calling calendar view. */
  highlight?: { start: string; end: string };
  weekStartsOn?: ChronoEonSettings["firstDay"];
  /** Render the calendar itself for an already-open host popover. */
  inline?: boolean;
}

export function GlassDatePicker({ value, onChange, ariaLabel, placeholder = "", locale, min, max, disabled, clearable = true, highlight, weekStartsOn, inline = false }: GlassDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => new Date());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const dateLocale = locale === "zh" ? zhCN : enUS;
  const { position, placed } = usePickerSurface(open, triggerRef, popupRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    setViewDate(value ? parseISO(value) : new Date());
  }, [open, value]);

  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(viewDate), { weekStartsOn: weekStartsOn ?? (locale === "zh" ? 1 : 0) });
    const last = endOfMonth(viewDate);
    return Array.from({ length: Math.ceil((last.getTime() - first.getTime()) / (24 * 60 * 60 * 1000) / 7) * 7 }, (_, index) => addDays(first, index));
  }, [locale, viewDate]);

  const weekdays = useMemo(() => {
    const first = startOfWeek(new Date(), { weekStartsOn: weekStartsOn ?? (locale === "zh" ? 1 : 0) });
    return Array.from({ length: 7 }, (_, index) => format(addDays(first, index), "EEEEE", { locale: dateLocale }));
  }, [dateLocale, locale]);

  function choose(day: Date) {
    onChange(format(day, "yyyy-MM-dd"));
    triggerRef.current?.focus();
    setOpen(false);
  }

  const selected = value ? parseISO(value) : null;
  // Composer fields are compact data controls; the calendar popup carries the
  // localized context while the closed value stays unambiguous ISO text.
  const display = selected ? format(selected, "yyyy-MM-dd") : "";

  const calendar = (
    <>
      <div className="glass-picker-month">
            <button type="button" className="picker-year-step" aria-label={locale === "zh" ? "上一年" : "Previous year"} onClick={() => setViewDate(new Date(viewDate.getFullYear() - 1, viewDate.getMonth(), 1))}>
              <Icon name="chevron-double-left" size={14} />
            </button>
            <button type="button" aria-label={locale === "zh" ? "上一月" : "Previous month"} onClick={() => setViewDate(addMonths(viewDate, -1))}>
              <Icon name="chevron-left" size={14} />
            </button>
            <strong>{format(viewDate, locale === "zh" ? "yyyy年M月" : "MMMM yyyy", { locale: dateLocale })}</strong>
            <button type="button" className="picker-today-btn" onClick={() => choose(new Date())} aria-label={locale === "zh" ? "今天" : "Today"} title={locale === "zh" ? "今天" : "Today"}>
              <Icon name="target" size={13} />
            </button>
            <button type="button" aria-label={locale === "zh" ? "下一月" : "Next month"} onClick={() => setViewDate(addMonths(viewDate, 1))}>
              <Icon name="chevron-right" size={14} />
            </button>
            <button type="button" className="picker-year-step" aria-label={locale === "zh" ? "下一年" : "Next year"} onClick={() => setViewDate(new Date(viewDate.getFullYear() + 1, viewDate.getMonth(), 1))}>
              <Icon name="chevron-double-right" size={14} />
            </button>
        </div>
          <div className="glass-date-week" aria-hidden="true">{weekdays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
          <div className="glass-date-grid" role="grid">
            {days.map((day) => {
              const outside = !isSameMonth(day, viewDate);
              const dayKey = format(day, "yyyy-MM-dd");
              const inHighlight = Boolean(highlight && dayKey >= highlight.start && dayKey <= highlight.end);
              const belowMin = Boolean(min && dayKey < min);
              const aboveMax = Boolean(max && dayKey > max);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  role="gridcell"
                  aria-selected={selected ? isSameDay(day, selected) : undefined}
                  className={[
                    "glass-date-cell",
                    outside ? "is-outside" : "",
                    inHighlight ? "is-highlight" : "",
                    selected && isSameDay(day, selected) ? "is-selected" : "",
                  ].filter(Boolean).join(" ")}
                  disabled={belowMin || aboveMax}
                  onClick={() => choose(day)}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>
          {clearable && (
            <button type="button" className="glass-picker-clear" onClick={() => { onChange(undefined); setOpen(false); }}>
              <Icon name="close" size={12} />{locale === "zh" ? "清除" : "Clear"}
            </button>
          )}
        </>
  );

  if (inline) {
    return <div className="glass-date-picker is-inline" role="dialog" aria-label={ariaLabel}>{calendar}</div>;
  }

  return (
    <div ref={rootRef} className={open ? "glass-date-picker is-open" : "glass-date-picker"}>
      <button
        ref={triggerRef}
        type="button"
        className="glass-picker-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="glass-picker-value">{display || (placeholder ? <em aria-hidden="true">{placeholder}</em> : "")}</span>
        <Icon name="calendar" size={14} />
      </button>
      <MotionPresence>{open && createPortal(
        <div
          ref={popupRef}
          role="dialog"
          aria-label={ariaLabel}
          className={[position.above ? "glass-picker-popup is-above" : "glass-picker-popup", placed ? "" : "is-unplaced"].filter(Boolean).join(" ")}
          style={pickerStyle(position)}
        >
          {calendar}
        </div>,
        document.body,
      )}</MotionPresence>
    </div>
  );
}

interface GlassTimePickerProps {
  value?: string;
  /** `committed` is false while a native time field reports an editing state. */
  onChange: (value?: string, committed?: boolean) => void;
  ariaLabel: string;
  locale: Locale;
  disabled?: boolean;
  clearable?: boolean;
}

export function GlassTimePicker({ value, onChange, ariaLabel, locale, disabled, clearable = true }: GlassTimePickerProps) {
  const [open, setOpen] = useState(false);
  const touchDevice = useTouchDevice();
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { position, placed } = usePickerSurface(open, rootRef, popupRef, () => setOpen(false), {
    preferredWidth: touchDevice ? 288 : 218,
    align: "end",
  });
  useEffect(() => {
    // Focus only after the portal is visible, not while it is being measured.
    if (!open || !placed || !touchDevice) return;
    const frame = requestAnimationFrame(() => popupRef.current?.querySelector<SVGElement>('[role="slider"]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, placed, touchDevice]);
  const [hour, minute] = value ? value.split(":").map((part) => Number(part) || 0) : [9, 0];

  function commit(nextHour: number, nextMinute: number) {
    onChange(`${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`, true);
  }

  const cyclicValues = (count: number, selected: number, step = 1, visible = 7) =>
    Array.from({ length: visible }, (_, offset) => {
      const raw = selected + (offset - Math.floor(visible / 2)) * step;
      return ((raw % count) + count) % count;
    });
  const hourValues = cyclicValues(24, hour);
  const minuteValues = cyclicValues(60, minute, 5);

  const stepHour = (delta: number) => commit((((hour + delta) % 24) + 24) % 24, minute);
  const stepMinute = (delta: number) => commit(hour, (((minute + delta) % 60) + 60) % 60);

  if (touchDevice) {
    return (
      <div ref={rootRef} className={open ? "glass-time-picker is-open is-touch" : "glass-time-picker is-touch"}>
        <button
          ref={toggleRef}
          type="button"
          className="glass-time-trigger"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => setOpen((current) => !current)}
        >
          {value || <em aria-hidden="true">--:--</em>}
          <Icon name="clock" size={14} />
        </button>
        <MotionPresence>{open && createPortal(
          <div
            ref={popupRef}
            role="dialog"
            aria-label={ariaLabel}
            className={[position.above ? "glass-picker-popup glass-picker-popup--dial is-above" : "glass-picker-popup glass-picker-popup--dial", placed ? "" : "is-unplaced"].filter(Boolean).join(" ")}
            style={pickerStyle(position)}
          >
            <TimeDial hour={hour} minute={minute} locale={locale} onChange={commit} />
            <div className="time-dial-actions">
              {clearable && <button type="button" className="glass-picker-clear" onClick={() => { onChange(undefined, true); setOpen(false); toggleRef.current?.focus(); }}>
                <Icon name="close" size={12} />{locale === "zh" ? "清除" : "Clear"}
              </button>}
              <button type="button" className="glass-picker-clear" onClick={() => { if (!value) commit(hour, minute); setOpen(false); toggleRef.current?.focus(); }}>
                <Icon name="check" size={12} />{locale === "zh" ? "完成" : "Done"}
              </button>
            </div>
          </div>,
          document.body,
        )}</MotionPresence>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={open ? "glass-time-picker is-open" : "glass-time-picker"}>
      <input
        type="time"
        step={60}
        className="glass-time-input"
        value={value ?? ""}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value || undefined)}
        onBlur={() => onChange(value, true)}
      />
      <button
        ref={toggleRef}
        type="button"
        className="glass-time-toggle"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={locale === "zh" ? `${ariaLabel}：打开时间滚轮` : `${ariaLabel}: open time wheel`}
        title={locale === "zh" ? "时间滚轮" : "Time wheel"}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="clock" size={14} />
      </button>
      <MotionPresence>{open && createPortal(
        <div
          ref={popupRef}
          role="dialog"
          aria-label={ariaLabel}
          className={[position.above ? "glass-picker-popup glass-picker-popup--time is-above" : "glass-picker-popup glass-picker-popup--time", placed ? "" : "is-unplaced"].filter(Boolean).join(" ")}
          style={pickerStyle(position)}
        >
          <div className="glass-time-columns">
            <section className="glass-time-column" aria-label={locale === "zh" ? "小时" : "Hour"} onWheel={(event) => { event.preventDefault(); stepHour(event.deltaY > 0 ? 1 : -1); }}>
              <button type="button" className="glass-time-step" disabled={disabled} aria-label={locale === "zh" ? "上一小时" : "Previous hour"} onClick={() => stepHour(-1)}>
                <Icon name="chevron-up" size={12} />
              </button>
              <div role="listbox" aria-label={locale === "zh" ? "小时" : "Hour"}>
                {hourValues.map((item) => (
                  <button key={item} type="button" role="option" aria-selected={item === hour} className={item === hour ? "is-selected" : ""} onClick={() => commit(item, minute)}>
                    {String(item).padStart(2, "0")}
                  </button>
                ))}
              </div>
              <button type="button" className="glass-time-step" disabled={disabled} aria-label={locale === "zh" ? "下一小时" : "Next hour"} onClick={() => stepHour(1)}>
                <Icon name="chevron-down" size={12} />
              </button>
            </section>
            <section className="glass-time-column" aria-label={locale === "zh" ? "分钟" : "Minute"} onWheel={(event) => { event.preventDefault(); stepMinute(event.deltaY > 0 ? 5 : -5); }}>
              <button type="button" className="glass-time-step" disabled={disabled} aria-label={locale === "zh" ? "往前五分钟" : "Five minutes earlier"} onClick={() => stepMinute(-5)}>
                <Icon name="chevron-up" size={12} />
              </button>
              <div role="listbox" aria-label={locale === "zh" ? "分钟" : "Minute"}>
                {minuteValues.map((item) => (
                  <button key={item} type="button" role="option" aria-selected={item === minute} className={item === minute ? "is-selected" : ""} onClick={() => commit(hour, item)}>
                    {String(item).padStart(2, "0")}
                  </button>
                ))}
              </div>
              <button type="button" className="glass-time-step" disabled={disabled} aria-label={locale === "zh" ? "往后五分钟" : "Five minutes later"} onClick={() => stepMinute(5)}>
                <Icon name="chevron-down" size={12} />
              </button>
            </section>
          </div>
          {clearable && (
            <button type="button" className="glass-picker-clear" onClick={() => { onChange(undefined, true); setOpen(false); }}>
              <Icon name="close" size={12} />{locale === "zh" ? "清除" : "Clear"}
            </button>
          )}
        </div>,
        document.body,
      )}</MotionPresence>
    </div>
  );
}
