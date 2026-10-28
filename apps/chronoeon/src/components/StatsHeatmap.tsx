import { useMemo } from "react";
import { addDays, addMonths, endOfMonth, format, parseISO, startOfWeek } from "date-fns";
import { reviewBuckets, currencySymbol, type ChronoEonSettings, type Entry, type Locale, type StatsRange } from "@chronoeon/domain";
import { t } from "../i18n";
import { usePersistentPreference } from "../hooks/usePersistentPreference";
import { GlassSelect } from "./GlassSelect";
import { Icon } from "./Icon";

export function StatsHeatmap({ entries, range, settings, locale, today, tab, options, onOpenDate }: {
  entries: Entry[]; range: StatsRange; settings: ChronoEonSettings; locale: Locale; today: string; tab: "bills" | "tasks";
  options: { key: string; label: string; color: string }[]; onOpenDate?: (date: string) => void;
}) {
  const [selection, setSelection] = usePersistentPreference<Record<string, string>>("stats-heatmap-category", { bills: "total", tasks: "total" });
  const selected = options.some(option => option.key === selection[tab]) ? selection[tab] : "total";
  const series = options.map(option => option.key === "total" ? { ...option, color: "var(--accent)" } : option);
  const data = useMemo(() => {
    const start = parseISO(range.start.slice(0, 7) + "-01");
    const end = endOfMonth(addMonths(start, 11));
    const endISO = format(end, "yyyy-MM-dd");
    const effectiveEnd = range.end < endISO ? range.end : endISO;
    const buckets = new Map(reviewBuckets(entries, { start: range.start, end: effectiveEnd }, "day", settings).map(bucket => [bucket.date, bucket]));
    const first = startOfWeek(start, { weekStartsOn: settings.firstDay });
    const days = [];
    for (let day = first; day <= end || days.length % 7; day = addDays(day, 1)) {
      const date = format(day, "yyyy-MM-dd");
      const inWindow = day >= start && day <= end;
      const inRange = inWindow && date >= range.start && date <= effectiveEnd;
      const bucket = inRange ? buckets.get(date) : undefined;
      const total = !bucket ? 0 : selected === "total" ? (tab === "bills" ? bucket.expense : bucket.scheduleTotal)
        : selected === "incomeTotal" ? bucket.billIncome
        : Math.abs((tab === "bills" ? bucket.billCategories : bucket.scheduleCategories)[selected.slice(9)] ?? 0);
      const key = selected;
      days.push({ date, inWindow, inRange, total, key, month: day.getMonth(), monthStart: day.getDate() === 1 });
    }
    const maximum = Math.max(0, ...days.map(day => day.total));
    return { days, maximum };
  }, [entries, range, settings, selected, tab]);
  const weeks = Array.from({ length: data.days.length / 7 }, (_, index) => data.days.slice(index * 7, index * 7 + 7));
  const amount = (value: number) => tab === "bills" ? `${currencySymbol(settings.bill.currency, settings)}${value.toLocaleString()}` : `${value} ${t("entriesSuffix", locale)}`;
  return <section className="stats-card panel">
    <header className="stats-card-header"><h3><Icon name="calendar" size={16} /> {t("statsHeatmap", locale)}</h3>
      <GlassSelect value={selected} options={series.map(option => ({ value: option.key, label: option.label, color: option.color }))} ariaLabel={`${t("statsHeatmap", locale)} · ${t("reviewCategories", locale)}`} className="review-categories" onChange={value => setSelection(current => ({ ...current, [tab]: value }))} />
    </header>
    <div className="heatmap-scroll"><div className="heatmap-grid" style={{ "--heatmap-weeks": weeks.length } as React.CSSProperties} role="group" aria-label={t("statsHeatmap", locale)}>
      <div className="heatmap-months">{data.days.map((day, index) => day.monthStart && day.inWindow ? <span key={day.date} style={{ gridColumnStart: Math.floor(index / 7) + 1 }}>{locale === "zh" ? `${day.month + 1}月` : format(parseISO(day.date), "MMM")}</span> : null)}</div>
      <div className="heatmap-weeks">{weeks.map((week, index) => <div className="heatmap-week" key={index}>{week.map(day => {
        const color = series.find(option => option.key === day.key)?.color ?? "var(--accent)";
        const level = day.total > 0 ? Math.max(1, Math.ceil(day.total / data.maximum * 4)) : 0;
        const label = `${day.date} · ${amount(day.total)}`;
        return <button type="button" key={day.date} className={`heatmap-cell heat-${level}${day.inWindow ? "" : " is-outside"}${day.inRange ? " is-in-range" : ""}${day.date === today ? " is-today" : ""}`} style={level ? { background: `color-mix(in srgb, ${color} ${[0, 28, 50, 74, 100][level]}%, var(--surface-muted))` } : undefined} title={label} aria-label={label} onClick={() => day.inRange && onOpenDate?.(day.date)} tabIndex={day.inRange && day.total > 0 ? 0 : -1} />;
      })}</div>)}</div>
    </div></div>
    <footer className="heatmap-legend"><span>{t("statsHeatmapLess", locale)}</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`heatmap-cell heat-${level}`} style={level ? { background: `color-mix(in srgb, ${series.find(option => option.key === selected)?.color ?? "var(--accent)"} ${[0, 28, 50, 74, 100][level]}%, var(--surface-muted))` } : undefined} />)}<span>{t("statsHeatmapMore", locale)}</span></footer>
  </section>;
}
