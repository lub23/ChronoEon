import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { addIsoDays, type Locale, type ReviewBucket, type ReviewGranularity } from "@chronoeon/domain";
import { t } from "../i18n";

export interface ReviewChartSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
  total?: boolean;
  average?: "expenseTotal" | "incomeTotal" | "scheduleTotal";
}

/** Keep endpoint names ordered by value, separated and inside the plot. */
export function spreadEndLabels(points: Array<{ key: string; y: number }>, top: number, bottom: number): Map<string, number> {
  const ordered = [...points].sort((a, b) => a.y - b.y);
  const placed: number[] = [];
  ordered.forEach((point, index) => { placed[index] = Math.max(point.y, index ? placed[index - 1] + 14 : top); });
  if (placed.length && placed[placed.length - 1] > bottom) {
    placed[placed.length - 1] = bottom;
    for (let i = placed.length - 2; i >= 0; i -= 1) placed[i] = Math.min(placed[i], placed[i + 1] - 14);
  }
  return new Map(ordered.map((point, index) => [point.key, placed[index]]));
}

function tooltipDate(date: string, granularity: ReviewGranularity, locale: Locale) {
  const formatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric", ...(granularity !== "year" ? { month: "short" } : {}),
    ...(granularity === "day" || granularity === "week" ? { day: "numeric" } : {}),
  });
  const start = new Date(date + "T00:00:00");
  return granularity === "week" ? formatter.formatRange(start, new Date(addIsoDays(date, 6) + "T00:00:00")) : formatter.format(start);
}

export function ReviewLineChart({ buckets, labels, series, ariaLabel, granularity, locale, formatValue, onOpenDate }: {
  buckets: Pick<ReviewBucket, "date">[];
  labels: string[];
  series: ReviewChartSeries[];
  ariaLabel: string;
  granularity: ReviewGranularity;
  locale: Locale;
  formatValue: (value: number) => string;
  onOpenDate?: (date: string) => void;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [touchActiveIndex, setTouchActiveIndex] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth > 0) setWidth(element.clientWidth); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = Math.max(190, series.length * 16 + 52);
  const labelWidth = Math.min(width * .22, Math.max(36, ...series.map(item =>
    [...item.label].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 10 : 5.6), 14))));
  const left = 10, right = Math.max(30, width - labelWidth - 18), top = 20, bottom = height - 24;
  const extent = useMemo(() => {
    let min = 0, max = 0;
    for (const item of series) for (const value of item.values) { min = Math.min(min, value); max = Math.max(max, value); }
    return { min, max: min === max ? max + 1 : max };
  }, [series]);
  const x = (index: number) => buckets.length <= 1 ? (left + right) / 2 : left + index / (buckets.length - 1) * (right - left);
  const y = (value: number) => bottom - (value - extent.min) / (extent.max - extent.min) * (bottom - top);
  const endLabels = spreadEndLabels(series.map(item => ({ key: item.key, y: y(item.values.at(-1) ?? 0) })), top, bottom);
  const total = series.find(item => item.total);
  const averageSeries = series.filter(item => item.average);
  const averages = averageSeries.map(item => ({
    item,
    kind: item.average!,
    value: item.values.length ? item.values.reduce((sum, value) => sum + value, 0) / item.values.length : 0,
  }));
  const averagePositions = spreadEndLabels(averages.map(({ item, value }) => ({ key: item.key, y: y(value) })), top + 8, bottom - 8);
  const averageLabelWidth = (label: string) => Math.min(right - left, Math.max(46, label.length * 6 + 12));
  const peakIndex = total?.values.reduce((best, value, index, values) =>
    Math.abs(value) > 0 && (best < 0 || Math.abs(value) > Math.abs(values[best])) ? index : best, -1) ?? -1;
  const axisLabels = useMemo(() => {
    const marked = labels.map((label, index) => ({ label, index })).filter(item => item.label);
    if (marked.length <= 1) return labels;
    const maxVisible = Math.max(2, Math.floor((right - left) / 48));
    const stride = Math.ceil(marked.length / maxVisible);
    const indexes = new Set(marked.filter((_, index) => index % stride === 0).map(item => item.index));
    const last = marked.at(-1)!.index;
    const lastVisible = Math.max(...indexes);
    if (last !== lastVisible) {
      if (indexes.size > 1 && x(last) - x(lastVisible) < 44) indexes.delete(lastVisible);
      indexes.add(last);
    }
    return labels.map((label, index) => indexes.has(index) ? label : "");
  }, [labels, right, buckets.length]);
  const isTouch = Boolean(window.matchMedia?.("(hover: none) and (pointer: coarse)").matches);
  const tooltipBucket = activeIndex === null ? null : buckets[activeIndex];
  function activate(index: number) {
    if (!isTouch || touchActiveIndex === index) onOpenDate?.(buckets[index].date);
    if (isTouch) setTouchActiveIndex(index);
    setActiveIndex(index);
  }
  const tooltipHalfWidth = Math.min(112, (width - 16) / 2);
  const tooltipHeight = (series.length + 1) * 14 + 14;

  return <div className="review-chart" ref={chartRef} role="group" aria-label={ariaLabel} style={{ height: series.length ? height : 48 }}>
    <span className="review-chart-metric">{ariaLabel}</span>
    {!series.length ? <p className="stats-empty">{t("reviewSelectSeries", locale)}</p> : <>
      <svg aria-hidden="true" width={width} height={height}>
        <line className="review-chart-baseline" x1={left} y1={y(0)} x2={right} y2={y(0)} />
        {buckets.length > 0 && averages.map(({ item, kind, value }) => {
          const label = formatValue(value);
          const labelWidth = averageLabelWidth(label);
          const labelY = averagePositions.get(item.key)!;
          const labelKey = kind === "expenseTotal" ? "reviewExpenseTotalAverage"
            : kind === "incomeTotal" ? "reviewIncomeTotalAverage" : "reviewTotalAverage";
          return <g key={item.key} aria-label={t(labelKey, locale)}>
            <line className={"review-chart-average" + (kind === "incomeTotal" ? " is-income" : "")}
              data-testid={`review-average-line-${kind}`} x1={left} y1={labelY} x2={right} y2={labelY} />
            <rect className="review-chart-average-pill" x={right - labelWidth} y={labelY - 8} width={labelWidth} height="16" rx="5" />
            <text className="review-chart-average-label" x={right - 4} y={labelY + 3} textAnchor="end">{label}</text>
          </g>;
        })}
        {[...series].sort((a, b) => Number(Boolean(a.total)) - Number(Boolean(b.total))).map(item => <g key={item.key}>
          {buckets.length > 1 && <polyline className={"review-chart-line" + (item.total ? " is-total" : "")}
            data-series={item.key} points={item.values.map((value, index) => x(index).toFixed(1) + "," + y(value).toFixed(1)).join(" ")}
            style={{ stroke: item.color }} />}
          {buckets.length === 1 && <circle cx={x(0)} cy={y(item.values[0] ?? 0)} r="3" style={{ fill: item.color }} />}
          <path className="review-chart-label-leader" d={"M " + right + " " + y(item.values.at(-1) ?? 0) + " L " + (right + 10) + " " + endLabels.get(item.key)} style={{ stroke: item.color }} />
          {activeIndex !== null && buckets[activeIndex] && <circle className="review-chart-hover-dot" cx={x(activeIndex)} cy={y(item.values[activeIndex] ?? 0)} r="3" style={{ fill: item.color }} />}
        </g>)}
        {axisLabels.map((label, index) => label ? <text key={buckets[index].date} className="review-chart-label" x={x(index)} y={height - 5}>{label}</text> : null)}
        {total && peakIndex >= 0 && <circle className="review-chart-peak-dot" data-testid="review-peak-dot" cx={x(peakIndex)} cy={y(total.values[peakIndex])} r="4" />}
      </svg>
        {series.map(item => <span key={item.key} data-series={item.key}
          className={"review-chart-end-label" + (item.total ? " is-total" : "")}
          title={item.label} style={{ color: item.color, left: right + 11, top: endLabels.get(item.key)! - 7, width: labelWidth }}>
          {item.label}
        </span>)}
      {buckets.map((bucket, index) => {
        const start = index ? (x(index - 1) + x(index)) / 2 : left;
        const end = index < buckets.length - 1 ? (x(index) + x(index + 1)) / 2 : right;
        const summary = series.map(item =>
          item.label + " " + formatValue(item.values[index] ?? 0)
        ).join(" · ");
        return <button key={bucket.date} type="button" className="review-chart-hit"
          style={{ left: start, width: Math.max(1, end - start) }} onClick={() => activate(index)}
          onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => { if (!isTouch) setActiveIndex(null); }}
          onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)}
          title={bucket.date + " · " + summary} aria-label={tooltipDate(bucket.date, granularity, locale) + " · " + summary} />;
      })}
      {tooltipBucket && activeIndex !== null && <div className="review-chart-tooltip" role="status" style={{
        left: Math.min(Math.max(x(activeIndex), tooltipHalfWidth + 8), width - tooltipHalfWidth - 8),
        top: Math.max(4, Math.min(height - tooltipHeight - 24, y(total?.values[activeIndex] ?? 0) - 30)), maxWidth: width - 16,
      }}>
        <strong>{tooltipDate(tooltipBucket.date, granularity, locale)}</strong>
        {series.map(item => <span className="review-chart-tooltip-row" key={item.key}>
          <i style={{ background: item.color }} />
          <span>{item.label}</span>
          <b>{formatValue(item.values[activeIndex] ?? 0)}</b>
        </span>)}
      </div>}
    </>}
  </div>;
}
