import { useId, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Locale } from "../domain/entry";

const SIZE = 288;
const CENTER = SIZE / 2;
const HOUR_RADIUS = 76;
const MINUTE_RADIUS = 122;
type Ring = "hour" | "minute";
const pad = (value: number) => String(value).padStart(2, "0");

/** Clockwise from twelve o'clock, including wraparound at 23/59. */
export function dialValueAt(x: number, y: number, count: number): number {
  const turn = Math.atan2(x, -y) / (Math.PI * 2);
  return ((Math.round(turn * count) % count) + count) % count;
}

function point(value: number, count: number, radius: number) {
  const angle = value / count * Math.PI * 2;
  return { x: CENTER + Math.sin(angle) * radius, y: CENTER - Math.cos(angle) * radius };
}

/** Two independent, absolute-position clock rings; no scroll lists or native menus. */
export function TimeDial({ hour, minute, locale, onChange }: {
  hour: number;
  minute: number;
  locale: Locale;
  onChange: (hour: number, minute: number) => void;
}) {
  const hintId = useId();
  const hourRef = useRef<SVGGElement>(null);
  const minuteRef = useRef<SVGGElement>(null);
  const drag = useRef<{ pointerId: number; ring: Ring } | null>(null);
  const latest = useRef({ hour, minute, onChange });
  latest.current = { hour, minute, onChange };
  const hourLabel = locale === "zh" ? "小时" : "Hour";
  const minuteLabel = locale === "zh" ? "分钟" : "Minute";

  function commit(ring: Ring, value: number) {
    const current = latest.current;
    if (current[ring] === value) return;
    latest.current = { ...current, [ring]: value };
    current.onChange(latest.current.hour, latest.current.minute);
  }

  function keyboard(event: KeyboardEvent<SVGGElement>, ring: Ring) {
    const count = ring === "hour" ? 24 : 60;
    const current = latest.current[ring];
    const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1
      : event.key === "ArrowUp" || event.key === "ArrowRight" ? (current + 1) % count
      : event.key === "ArrowDown" || event.key === "ArrowLeft" ? (current + count - 1) % count : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    commit(ring, next);
  }

  function coordinates(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * SIZE / rect.width - CENTER,
      y: (event.clientY - rect.top) * SIZE / rect.height - CENTER,
    };
  }

  function begin(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || drag.current) return;
    const { x, y } = coordinates(event);
    const radius = Math.hypot(x, y);
    if (radius < 52 || radius > 144) return;
    const ring: Ring = radius < 100 ? "hour" : "minute";
    drag.current = { pointerId: event.pointerId, ring };
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    (ring === "hour" ? hourRef : minuteRef).current?.focus({ preventScroll: true });
    commit(ring, dialValueAt(x, y, ring === "hour" ? 24 : 60));
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { x, y } = coordinates(event);
    // Keep the chosen ring for the entire gesture, even if the finger drifts.
    if (Math.hypot(x, y) < 24) return;
    const ring = drag.current.ring;
    commit(ring, dialValueAt(x, y, ring === "hour" ? 24 : 60));
  }

  function finish(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const hourPoint = point(hour, 24, HOUR_RADIUS);
  const minutePoint = point(minute, 60, MINUTE_RADIUS);
  return (
    <div className="time-dial">
      <div className="time-dial-legend" aria-hidden="true"><span>{hourLabel}</span><span>{minuteLabel}</span></div>
      <svg className="time-dial-face" viewBox={`0 0 ${SIZE} ${SIZE}`} role="group"
        aria-label={locale === "zh" ? "时分双环时间盘" : "Hour and minute dial"}
        onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
        onLostPointerCapture={() => { drag.current = null; }}>
        <g ref={hourRef} className="time-dial-ring time-dial-ring--hour" role="slider" tabIndex={0}
          aria-label={hourLabel} aria-valuemin={0} aria-valuemax={23} aria-valuenow={hour} aria-valuetext={pad(hour)}
          aria-describedby={hintId} onKeyDown={(event) => keyboard(event, "hour")}>
          <circle className="time-dial-track" cx={CENTER} cy={CENTER} r={HOUR_RADIUS} />
          <circle className="time-dial-selection" {...{ cx: hourPoint.x, cy: hourPoint.y }} r={10} />
          {Array.from({ length: 24 }, (_, value) => <text key={value} {...point(value, 24, HOUR_RADIUS)}
            className={value === hour ? "is-selected" : ""} aria-hidden="true">{pad(value)}</text>)}
        </g>
        <g ref={minuteRef} className="time-dial-ring time-dial-ring--minute" role="slider" tabIndex={0}
          aria-label={minuteLabel} aria-valuemin={0} aria-valuemax={59} aria-valuenow={minute} aria-valuetext={pad(minute)}
          aria-describedby={hintId} onKeyDown={(event) => keyboard(event, "minute")}>
          <circle className="time-dial-track" cx={CENTER} cy={CENTER} r={MINUTE_RADIUS} />
          {Array.from({ length: 60 }, (_, value) => {
            const start = point(value, 60, 137);
            const end = point(value, 60, value % 5 === 0 ? 141 : 139);
            return <line key={value} {...{ x1: start.x, y1: start.y, x2: end.x, y2: end.y }} className="time-dial-tick" aria-hidden="true" />;
          })}
          <circle className="time-dial-selection" {...{ cx: minutePoint.x, cy: minutePoint.y }} r={11} />
          {Array.from({ length: 60 }, (_, value) => {
            const distance = Math.min(Math.abs(value - minute), 60 - Math.abs(value - minute));
            if (value !== minute && (value % 5 !== 0 || distance < 2)) return null;
            return <text key={value} {...point(value, 60, MINUTE_RADIUS)} className={value === minute ? "is-selected" : ""} aria-hidden="true">{pad(value)}</text>;
          })}
        </g>
        <text className="time-dial-value" x={CENTER} y={CENTER} aria-hidden="true">{pad(hour)}:{pad(minute)}</text>
      </svg>
      <p id={hintId} className="time-dial-hint">{locale === "zh" ? "内圈调小时，外圈调分钟 · 精确到1分钟" : "Inner ring: hours · Outer ring: minutes · 1-min precision"}</p>
    </div>
  );
}
