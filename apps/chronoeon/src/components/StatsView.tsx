import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import {
  aggregateBillStats,
  aggregateTaskStats,
  buildReview,
  collectTags,
  currencySymbol,
  expenseHeatmap,
  formatMinutes,
  keywordStats,
  outstandingTaskSections,
  statsPresetRange,
  reviewGranularities,
  reviewCategoryOptions,
  reviewBuckets,
  type BillCategoryStat,
  type BillSubCategoryStat,
  type ChronoEonSettings,
  type Entry,
  type EntryStatus,
  type Locale,
  type ReviewBucket,
  type ReviewGranularity,
  type StatsPresetKey,
  type StatsRange
} from "@chronoeon/domain";
import { catalogLabel, categoryLabel, compositeCategoryLabel, t, type MessageKey } from "../i18n";
import { GlassDatePicker } from "./GlassDateTimePicker";
import { GlassSelect } from "./GlassSelect";
import { ReviewLineChart, type ReviewChartSeries } from "./ReviewLineChart";
import { FadeText } from "./FadeText";
import { Icon } from "./Icon";
import { TaskSummaryList } from "./TaskSummaryList";
import { registerModalDismiss } from "./modalLayer";
import { usePersistentPreference } from "../hooks/usePersistentPreference";

interface StatsViewProps {
  entries: Entry[];
  locale: Locale;
  settings: ChronoEonSettings;
  today: string;
  search?: string;
  onToggle?: (id: string, entry?: Entry) => void;
  onStatus?: (entry: Entry, status: EntryStatus) => void;
  onOpenDate?: (date: string) => void;
}

type StatsTab = "bills" | "tasks";
interface CategoryDetail {
  title: string;
  color: string;
  entries: Entry[];
}
interface SplitConnector {
  d: string;
  x: number;
  y: number;
  endX: number;
  endY: number;
  color: string;
  label?: string;
}

const presets: Array<{ key: StatsPresetKey; label: MessageKey }> = [
  { key: "7d", label: "range7d" },
  { key: "1m", label: "range1m" },
  { key: "3m", label: "range3m" },
  { key: "1y", label: "range1y" },
  { key: "this_week", label: "rangeThisWeek" },
  { key: "this_month", label: "rangeThisMonth" },
  { key: "this_year", label: "rangeThisYear" }
];

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function money(symbol: string, amount: number): string {
  const rounded = Math.abs(amount) >= 1000 ? Math.round(amount) : Math.round(amount * 100) / 100;
  return `${amount < 0 ? "−" : ""}${symbol}${Math.abs(rounded).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** Colour already identifies cash-flow direction, so category bars omit signs. */
function unsignedMoney(symbol: string, amount: number): string {
  return money(symbol, Math.abs(amount));
}

function categoryText(category: string | undefined, locale: Locale): string {
  if (!category?.trim()) return t("categoryUncategorized", locale);
  return category.includes("/")
    ? compositeCategoryLabel(category, locale)
    : categoryLabel(category, locale, catalogLabel(category, locale));
}

function monthLabel(month: number, locale: Locale): string {
  if (locale === "zh") return String(month + 1);
  return MONTHS_EN[month];
}

function formatRange(range: StatsRange, locale: Locale): string {
  const [y1, m1, d1] = range.start.split("-").map(Number);
  const [y2, m2, d2] = range.end.split("-").map(Number);
  if (locale === "zh") {
    return y1 === y2
      ? `${m1}月${d1}日 – ${m2}月${d2}日`
      : `${y1}年${m1}月${d1}日 – ${y2}年${m2}月${d2}日`;
  }
  return y1 === y2
    ? `${MONTHS_EN[m1 - 1]} ${d1} – ${MONTHS_EN[m2 - 1]} ${d2}`
    : `${MONTHS_EN[m1 - 1]} ${d1}, ${y1} – ${MONTHS_EN[m2 - 1]} ${d2}, ${y2}`;
}

function bucketLabels(buckets: ReviewBucket[], granularity: ReviewGranularity, locale: Locale): string[] {
  if (granularity === "year") {
    return buckets.map((b) => b.date.slice(0, 4));
  }
  const multipleYears = buckets[0]?.date.slice(0, 4) !== buckets.at(-1)?.date.slice(0, 4);
  if (granularity === "month") {
    return buckets.map(b => (multipleYears ? b.date.slice(0, 4) + "/" : "") + monthLabel(Number(b.date.slice(5, 7)) - 1, locale));
  }
  if (granularity === "week") {
    return buckets.map(b => (multipleYears ? b.date.slice(2, 4) + "/" : "") + Number(b.date.slice(5, 7)) + "/" + Number(b.date.slice(8, 10)));
  }
  if (buckets.length <= 7) {
    return buckets.map((b) =>
      new Date(`${b.date}T00:00:00`).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { weekday: "narrow" }),
    );
  }
  if (buckets.length <= 31) {
    return buckets.map((b) => String(Number(b.date.slice(8, 10))));
  }
  // Choose indices on one even scale. Month-start labels must not be forced in
  // addition to that scale, or the axis can paint two dates only days apart.
  const step = Math.ceil(buckets.length / 12);
  const visibleTicks = new Set<number>();
  for (let tick = 0; tick <= 12; tick += 1) {
    visibleTicks.add(Math.min(buckets.length - 1, tick * step));
  }
  return buckets.map((b, i) => {
    const day = Number(b.date.slice(8, 10));
    if (visibleTicks.has(i)) {
      const month = Number(b.date.slice(5, 7));
      return `${month}/${day}`;
    }
    return "";
  });
}

export function StatsView({ entries, locale, settings, today, search = "", onToggle, onStatus, onOpenDate }: StatsViewProps) {
  const [tab, setTab] = usePersistentPreference<StatsTab>("stats-tab", "bills");
  const [preset, setPreset] = usePersistentPreference<StatsPresetKey>("stats-preset", "this_month");
  const [customRange, setCustomRange] = usePersistentPreference<StatsRange | null>("stats-custom-range", null);
 const [keyword, setKeyword] = usePersistentPreference("stats-keyword", "");
  const [granularity, setGranularity] = usePersistentPreference<{ range: string; value: ReviewGranularity } | null>("stats-review-granularity", null);
  const [hiddenSeries, setHiddenSeries] = usePersistentPreference<Record<StatsTab, string[]>>("stats-review-hidden-series", { bills: [], tasks: [] });
 const [detail, setDetail] = useState<CategoryDetail | null>(null);
 const [isRangePending, startRangeTransition] = useTransition();

 const range = useMemo(
   () => customRange ?? statsPresetRange(preset, today, settings.firstDay),
   [customRange, preset, settings.firstDay, today]
 );
  const review = useMemo(() => buildReview(entries, range, settings, today), [entries, range, settings, today]);
 const symbol = currencySymbol(settings.bill.currency, settings);

 const bills = useMemo(() => aggregateBillStats(entries, range, settings), [entries, range, settings]);
 const tasks = useMemo(() => aggregateTaskStats(entries, range, settings, locale), [entries, locale, range, settings]);
 const heatmap = useMemo(
   () => expenseHeatmap(entries, Number(today.slice(0, 4)), settings.firstDay, settings),
   [entries, settings, today]
 );
 const scopedEntries = useMemo(() => entries.filter((entry) => tab === "bills"
   ? entry.kind === "bill"
   : entry.kind === "task" || entry.kind === "event" || entry.kind === "idea"
 ), [entries, tab]);
 const keywords = useMemo(() => keywordStats(scopedEntries, range, keyword, settings), [keyword, range, scopedEntries, settings]);
 const tagSuggestions = useMemo(() => collectTags(scopedEntries, 12), [scopedEntries]);
  const rangeKey = range.start + "/" + range.end;
  const granularityOptions = useMemo(() => {
    const labels: Record<ReviewGranularity, MessageKey> = { day: "statsByDay", week: "statsByWeek", month: "statsByMonth", year: "statsByYear" };
    return reviewGranularities(range).map(value => ({ value, label: labels[value] }));
  }, [range]);
  const effectiveGranularity = granularity?.range === rangeKey && granularityOptions.some(option => option.value === granularity.value)
    ? granularity.value : granularityOptions.at(-1)!.value;
  const buckets = useMemo(
    () => reviewBuckets(entries, range, effectiveGranularity, settings),
    [entries, range, effectiveGranularity, settings],
  );
  const reviewLabels = useMemo(
    () => bucketLabels(buckets, effectiveGranularity, locale),
    [buckets, effectiveGranularity, locale],
  );
  const categoryOptions = useMemo(() => reviewCategoryOptions(entries, tab === "bills" ? "bill" : "schedule", settings), [entries, tab, settings]);
  const allSeries = useMemo<ReviewChartSeries[]>(() => [
    tab === "bills"
      ? { key: "total", label: t("reviewExpenseShort", locale), color: "#c0392b", total: true, average: "expenseTotal" as const,
          values: buckets.map(bucket => bucket.expense) }
      : { key: "total", label: t("reviewTotal", locale), color: "var(--accent)", total: true, average: "scheduleTotal" as const,
          values: buckets.map(bucket => bucket.scheduleTotal) },
    ...(tab === "bills" ? [{
      key: "incomeTotal", label: t("reviewIncomeShort", locale), color: "#2f8f5b",
      average: "incomeTotal" as const,
      values: buckets.map(bucket => bucket.billIncome),
    }] : []),
    ...categoryOptions.map(option => {
      const label = categoryLabel(option.value, locale, catalogLabel(option.value, locale, option.label));
      if (tab !== "bills") return { key: "category:" + option.value, label,
        color: option.color ?? "var(--ink-faint)",
        values: buckets.map(bucket => bucket.scheduleCategories[option.value] ?? 0),
      };
      return { key: "category:" + option.value, label,
        color: option.color ?? "var(--ink-faint)",
        values: buckets.map(bucket => Math.abs(bucket.billCategories[option.value] ?? 0)),
      };
    }),
  ], [buckets, categoryOptions, locale, settings, tab]);
  const reviewSeries = useMemo(() => allSeries.filter(item => !hiddenSeries[tab].includes(item.key)), [allSeries, hiddenSeries, tab]);
  const outstanding = useMemo(
    () => outstandingTaskSections(entries, today, range),
    [entries, range, today],
  );

  useEffect(() => {
    if (!detail) return;
    const dismiss = registerModalDismiss(() => setDetail(null));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("stats-detail-open");
    return () => {
      dismiss();
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("stats-detail-open");
    };
  }, [detail]);

  function selectPreset(key: StatsPresetKey) {
    startRangeTransition(() => {
      setPreset(key);
      setCustomRange(null);
    });
  }

  function selectCustomDate(value: string | undefined, edge: "start" | "end") {
    startRangeTransition(() => {
      setCustomRange(edge === "start"
        ? { start: value || range.end, end: range.end }
        : { start: range.start, end: value || range.start });
    });
  }

  return (
    <section className="stats-page">
      <header className="page-title-row view-title-row">
        <div>
          <h2 className="view-heading"><span className="headline-leaf">{t("insightsTitle", locale)}</span></h2>
        </div>
        <div className="stats-custom-range">
          <label>
            <span className="visually-hidden">{t("date", locale)}</span>
            <GlassDatePicker
              value={range.start}
              max={range.end}
              ariaLabel={t("date", locale)}
              placeholder={t("dateAny", locale)}
              locale={locale}
              clearable={false}
              onChange={(value) => selectCustomDate(value, "start")}
            />
          </label>
          <span aria-hidden="true">→</span>
          <label>
            <span className="visually-hidden">{t("endDate", locale)}</span>
            <GlassDatePicker
              value={range.end}
              min={range.start}
              ariaLabel={t("endDate", locale)}
              placeholder={t("dateAny", locale)}
              locale={locale}
              clearable={false}
              onChange={(value) => selectCustomDate(value, "end")}
            />
          </label>
        </div>
      </header>

      {isRangePending && (
        <div className="stats-loading" role="status" aria-live="polite">
          <i aria-hidden="true" />
          {t("loading", locale)}
        </div>
      )}

      <div className="stats-toolbar panel">
        <div className="stats-tabs" role="tablist" aria-label={t("insights", locale)}>
          <button type="button" role="tab" aria-selected={tab === "bills"} className={tab === "bills" ? "is-active" : ""} onClick={() => setTab("bills")}>
            <Icon name="coins" size={15} />{t("statsBills", locale)}
          </button>
          <button type="button" role="tab" aria-selected={tab === "tasks"} className={tab === "tasks" ? "is-active" : ""} onClick={() => setTab("tasks")}>
            <Icon name="clock" size={15} />{t("statsTasks", locale)}
          </button>
        </div>

        <div className="stats-range" role="group" aria-label={t("statsPeriod", locale)}>
          {presets.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={!customRange && preset === item.key}
              className={!customRange && preset === item.key ? "is-active" : ""}
              onClick={() => selectPreset(item.key)}
            >
              {t(item.label, locale)}
            </button>
          ))}
        </div>

      </div>

      {search.trim() && (
        <section className="stats-card panel">
          <header className="stats-card-header">
            <h3><Icon name="search" size={16} /> {t("searchResults", locale)}</h3>
            <span className="stats-card-total">{entries.length}</span>
          </header>
          {entries.length === 0 ? (
            <p className="stats-empty">{t("filterNoResults", locale)}</p>
          ) : (
            <ul className="stats-match-list">
              {entries.slice(0, 40).map((entry) => (
                <li key={`${entry.id}:${entry.date}`}>
                  <button type="button" onClick={() => onOpenDate?.(entry.date)}>
                    <span className="stats-match-date">{entry.date}</span>
                    <span className="stats-match-title">{entry.title}</span>
                    <span className="stats-match-cat">
                      <i style={{ background: entry.color ?? "var(--accent)" }} aria-hidden="true" />
                      {categoryText(entry.category, locale)}
                    </span>
                    {entry.kind === "bill" && typeof entry.amount === "number" && (
                      <span className={entry.amount >= 0 ? "is-income" : "is-expense"}>{money(symbol, Math.abs(entry.amount))}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "bills" ? (
        <BillsPanel bills={bills} locale={locale} symbol={symbol} onOpenDetail={setDetail} />
      ) : (
        <TasksPanel tasks={tasks} locale={locale} />
      )}

      <section className="stats-card panel stats-review-card">
        <header className="stats-card-header">
         <h3><Icon name="book" size={16} /> {t("review", locale)}</h3>
         <div className="stats-review-nav">
            <strong>{formatRange(range, locale)}</strong>
            <div className="review-controls">
            <GlassSelect multiple value={reviewSeries.map(item => item.key)}
              options={allSeries.map(item => ({ value: item.key,
                label: item.label, color: item.color }))}
              summaryLabel={t("reviewCategories", locale)} ariaLabel={t("reviewCategories", locale)} className="review-categories"
              onChange={selected => setHiddenSeries(current => ({ ...current, [tab]: allSeries.filter(item => !selected.includes(item.key)).map(item => item.key) }))} />
            {granularityOptions.length > 1 && (
              <GlassSelect
                value={effectiveGranularity}
                options={granularityOptions.map((o) => ({ value: o.value, label: t(o.label, locale) }))}
                onChange={(v) => startRangeTransition(() => setGranularity({ range: rangeKey, value: v as ReviewGranularity }))}
                ariaLabel={t("statsGranularity", locale)}
                className="review-granularity"
              />
            )}
            </div>
         </div>
       </header>

       {tab === "bills" ? (
         <BillsReview
            series={reviewSeries}
            buckets={buckets}
            labels={reviewLabels}
           expense={review.expense}
           symbol={symbol}
           locale={locale}
           granularity={effectiveGranularity}
           bills={bills}
           onOpenDate={onOpenDate}
         />
       ) : (
          <TasksReview
            series={reviewSeries}
            review={review}
            buckets={buckets}
            labels={reviewLabels}
            locale={locale}
            settings={settings}
            granularity={effectiveGranularity}
            onToggle={onToggle}
            onStatus={onStatus}
            overdue={outstanding.overdue}
            upcoming={outstanding.upcoming}
            onOpenDate={onOpenDate}
          />
       )}
     </section>

      <section className="stats-card panel">
        <header className="stats-card-header">
          <h3><Icon name="tag" size={16} /> {t("statsKeyword", locale)}</h3>
        </header>
        <div className="stats-keyword-input">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t("statsKeywordPlaceholder", locale)}
            aria-label={t("statsKeyword", locale)}
          />
        </div>
        {tagSuggestions.length > 0 && (
          <div className="stats-tag-suggestions">
            <span>{t("statsSuggestedTags", locale)}</span>
            {tagSuggestions.map((item) => (
              <button key={item.tag} type="button" onClick={() => setKeyword(`#${item.tag}`)}>#{item.tag} · {item.count}</button>
            ))}
          </div>
        )}
        {keyword.trim() && (
          keywords.entries.length === 0
            ? <p className="stats-empty">{t("statsNoMatches", locale)}</p>
            : (
              <>
                <div className="stats-kpi-row">
                  <Kpi label={t("statsMatches", locale)} value={String(keywords.entries.length)} />
                  {keywords.billCount > 0 && <Kpi label={t("statsNet", locale)} value={money(symbol, keywords.net)} tone={keywords.net >= 0 ? "income" : "expense"} />}
                  {keywords.timedCount > 0 && <Kpi label={t("statsTotalLabel", locale)} value={formatMinutes(keywords.totalMinutes)} />}
                  {keywords.timedCount > 0 && <Kpi label={t("statsAverage", locale)} value={formatMinutes(Math.round(keywords.averageMinutes))} />}
                </div>
                <ul className="stats-match-list">
                  {keywords.entries.slice(0, 40).map((entry) => (
                    <li key={`${entry.id}:${entry.date}`}>
                      <button type="button" onClick={() => onOpenDate?.(entry.date)}>
                        <span className="stats-match-date">{entry.date}</span>
                        <span className="stats-match-title">{entry.title}</span>
                        <span className="stats-match-cat">
                          <i style={{ background: entry.color ?? "var(--accent)" }} aria-hidden="true" />
                          {categoryText(entry.category, locale)}
                        </span>
                        {entry.kind === "bill" && typeof entry.amount === "number" && (
                          <span className={entry.amount >= 0 ? "is-income" : "is-expense"}>{money(symbol, entry.amount)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
        )}
      </section>

      {tab === "bills" && (
      <section className="stats-card panel">
        <header className="stats-card-header">
          <h3><Icon name="calendar" size={16} /> {t("statsHeatmap", locale)}</h3>
          <span className="stats-card-total">{t("statsHeatmapYearTotal", locale)} · {money(symbol, -heatmap.total)}</span>
        </header>
        <div className="heatmap-scroll">
          <div className="heatmap-grid" role="img" aria-label={`${t("statsHeatmap", locale)} ${heatmap.year}`}>
            <div className="heatmap-months">
              {heatmap.monthLabels.map((label) => (
                <span key={`${label.week}-${label.month}`} style={{ gridColumnStart: label.week + 1 }}>{monthLabel(label.month, locale)}</span>
              ))}
            </div>
            <div className="heatmap-weeks">
              {heatmap.weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="heatmap-week">
                  {week.map((day) => (
                    <button
                      key={day.date}
                      type="button"
                      className={`heatmap-cell heat-${day.level}${day.inYear ? "" : " is-outside"}${day.date === today ? " is-today" : ""}`}
                      title={day.inYear ? `${day.date} · ${day.total > 0 ? money(symbol, -day.total) : t("statsHeatmapLess", locale)}` : day.date}
                      aria-label={`${day.date} ${day.total > 0 ? money(symbol, -day.total) : ""}`}
                      onClick={() => day.inYear && onOpenDate?.(day.date)}
                      tabIndex={day.inYear && day.total > 0 ? 0 : -1}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        <footer className="heatmap-legend">
          <span>{t("statsHeatmapLess", locale)}</span>
          {[0, 1, 2, 3, 4].map((level) => <i key={level} className={`heatmap-cell heat-${level}`} />)}
          <span>{t("statsHeatmapMore", locale)}</span>
       </footer>
      </section>
      )}

     <MotionPresence>{detail && createPortal(
        <div className="stats-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}>
          <section className="stats-detail panel" role="dialog" aria-modal="true" aria-label={detail.title}>
            <header className="stats-detail-header">
              <span className="stats-detail-swatch" style={{ background: detail.color }} aria-hidden="true" />
              <div>
                <h3>{detail.title}</h3>
                <small>{detail.entries.length} {t("entriesSuffix", locale)}</small>
              </div>
              <button type="button" className="icon-button subtle" onClick={() => setDetail(null)} aria-label={t("close", locale)}><Icon name="close" size={15} /></button>
            </header>
            <ul className="stats-match-list stats-detail-list">
              {detail.entries.map((entry) => (
                <li key={`${entry.id}:${entry.date}`}>
                  <button type="button" onClick={() => { setDetail(null); onOpenDate?.(entry.date); }}>
                    <span className="stats-match-date">{entry.date}</span>
                    <span className="stats-match-title">{entry.title}</span>
                    {typeof entry.amount === "number" && (
                      <span className={entry.amount >= 0 ? "is-income" : "is-expense"}>{money(symbol, Math.abs(entry.amount))}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>,
        document.body,
      )}</MotionPresence>
    </section>
  );

}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "income" | "expense" }) {
  return (
    <div className={`stats-kpi${tone ? ` is-${tone}` : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function DeltaBadge({ value, locale, invert = false, format }: { value: { current: number; previous: number; delta: number }; locale: Locale; invert?: boolean; format: (input: number) => string }) {
  const rounded = Math.round(value.delta * 100) / 100;
  if (rounded === 0) return <em className="review-delta is-flat">{t("reviewNoChange", locale)}</em>;
  const good = invert ? rounded < 0 : rounded > 0;
  return (
    <em className={good ? "review-delta is-up" : "review-delta is-down"}>
      {rounded > 0 ? "▲" : "▼"} {format(Math.abs(rounded))}
    </em>
  );
}

function BillsPanel({
  bills,
  locale,
  symbol,
  onOpenDetail,
}: {
  bills: ReturnType<typeof aggregateBillStats>;
  locale: Locale;
  symbol: string;
  onOpenDetail: (detail: CategoryDetail) => void;
}) {
  if (bills.count === 0) return <section className="stats-card panel"><p className="stats-empty">{t("statsNoBills", locale)}</p></section>;

  return (
    <>
      <div className="stats-kpi-row stats-kpi-row--headline">
        <Kpi label={t("statsIncome", locale)} value={money(symbol, bills.income)} tone="income" />
        <Kpi label={t("statsExpense", locale)} value={money(symbol, bills.expense)} tone="expense" />
        <Kpi label={t("statsBalance", locale)} value={money(symbol, bills.balance)} tone={bills.balance >= 0 ? "income" : "expense"} />
        <Kpi label={t("statsDailyAvg", locale)} value={money(symbol, bills.dailyAverageExpense)} />
      </div>

      <section className="stats-card panel">
        <header className="stats-card-header">
          <h3><Icon name="wallet" size={16} /> {t("statsCategoryBreakdown", locale)}</h3>
        </header>
        <ul className="stats-split-list">
          {bills.categories.map((category) => (
            <CategorySplitCard key={category.id} bills={bills} category={category} locale={locale} symbol={symbol} onOpenDetail={onOpenDetail} />
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * A primary category is measured against its own cash flow: every income card
 * shares the income total, and every expense card shares the expense total.
 * The coloured bar length is that flow share; its internal cuts show subs.
 */
function CategorySplitCard({
  bills,
  category,
  locale,
  symbol,
  onOpenDetail,
}: {
  bills: ReturnType<typeof aggregateBillStats>;
  category: BillCategoryStat;
  locale: Locale;
  symbol: string;
  onOpenDetail: (detail: CategoryDetail) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const categoryRef = useRef<HTMLLIElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const subNameRefs = useRef(new Map<number, HTMLElement>());
  const [connectors, setConnectors] = useState<SplitConnector[]>([]);
  const subs = category.sub;
  const segments: Array<BillSubCategoryStat & { color: string }> = subs.length
    ? subs.map((sub) => ({ ...sub, color: category.color }))
    : [{ name: category.id, count: category.count, total: category.total, entries: category.entries, color: category.color }];
  const flowTotal = category.total >= 0 ? bills.income : bills.expense;
  const flowShare = flowTotal > 0 ? (Math.abs(category.total) / flowTotal) * 100 : 0;
  const label = categoryLabel(category.id, locale, catalogLabel(category.id, locale, category.name));

  /** One vertical descent to the endpoint's level, then one horizontal turn. */
  function singleElbow(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): string {
    const radius = Math.min(10, Math.abs(endX - startX) / 2, Math.abs(endY - startY));
    const inward = endX >= startX ? 1 : -1;
    const down = endY > startY ? 1 : -1;
    return [
      `M${startX.toFixed(1)} ${startY.toFixed(1)}`,
      `V${(endY - down * radius).toFixed(1)}`,
      `Q${startX.toFixed(1)} ${endY.toFixed(1)} ${(startX + inward * radius).toFixed(1)} ${endY.toFixed(1)}`,
      `H${endX.toFixed(1)}`,
    ].join(" ");
  }

  useLayoutEffect(() => {
    if (!expanded || subs.length === 0) {
      setConnectors([]);
      return;
    }

    const measure = () => {
      const host = categoryRef.current;
      const bar = barRef.current;
      if (!host || !bar) return;
      const hostRect = host.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const next: SplitConnector[] = [];
      const marks = subs.map((_, index) => {
        const segment = bar.children[index] as HTMLElement | undefined;
        const target = subNameRefs.current.get(index);
        if (!segment || !target) return null;
        const segmentRect = segment.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const barLeft = barRect.left - hostRect.left;
        return {
          startX: segmentRect.left + segmentRect.width / 2 - hostRect.left,
          startY: segmentRect.top + segmentRect.height / 2 - hostRect.top,
          endX: Math.max(0, barLeft - 1),
          endY: targetRect.top + targetRect.height / 2 - hostRect.top,
        };
      });
      const usable = marks.filter((mark): mark is NonNullable<typeof mark> => mark !== null);
      if (usable.length === subs.length) {
        usable.forEach((mark, idx) => {
          const sub = subs[idx];
          const subShare = category.total !== 0
            ? Math.round(Math.abs(sub.total) / Math.abs(category.total) * 1000) / 10
            : 0;
          next.push({
            d: singleElbow(mark.startX, mark.startY, mark.endX, mark.endY),
            x: mark.startX,
            y: mark.startY,
            endX: mark.endX,
            endY: mark.endY,
            color: category.color,
            label: subShare > 0 ? `${subShare}%` : "",
          });
        });
      }
      setConnectors(next);
    };

    measure();
    if (!categoryRef.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(categoryRef.current);
    return () => observer.disconnect();
  }, [category.color, expanded, subs]);

  return (
    <li
      ref={categoryRef}
      className="stats-split-category"
    >
      <div className="stats-split-head">
        {subs.length > 0 ? (
          <button
            type="button"
            className="stats-split-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? t("statsCollapse", locale) : t("statsExpand", locale)}
          >
            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={13} />
          </button>
        ) : (
          <span className="stats-split-toggle-space" aria-hidden="true" />
        )}
        <button
          type="button"
          className="stats-split-name-btn"
          onClick={() => onOpenDetail({ title: label, color: category.color, entries: category.entries })}
        >
         <span className="stats-split-name">
          <span className="stats-split-name-text">
           {label}
            <small>({category.count})</small>
            </span>
          </span>
        </button>
        <span ref={barRef} className="stats-split-bar" role="img" aria-label={`${label} ${unsignedMoney(symbol, category.total)} (${flowShare.toFixed(1)}%)`}>
          {segments.map((segment, index) => (
            <i
              key={segment.name}
              data-last={index === segments.length - 1 || undefined}
              style={{ flexGrow: Math.max(1, Math.abs(segment.total)), "--seg-color": segment.color } as React.CSSProperties}
            />
          ))}
        </span>
        <div className="stats-split-value">
          <strong className={category.total >= 0 ? "is-income" : "is-expense"}>{unsignedMoney(symbol, category.total)}</strong>
          <small>{flowShare.toFixed(1)}%</small>
        </div>
      </div>

      {subs.length > 0 && expanded && (
        <ul className="stats-split-subs" style={{ "--link-color": category.color } as React.CSSProperties}>
          {subs.map((sub, subIndex) => {
            return (
              <li key={sub.name}>
                <button
                  type="button"
                  className="stats-split-sub"
                  onClick={() => onOpenDetail({ title: catalogLabel(sub.name, locale), color: category.color, entries: sub.entries })}
                >
                  <span
                    className="stats-split-sub-name"
                    ref={(element) => {
                      if (element) subNameRefs.current.set(subIndex, element);
                      else subNameRefs.current.delete(subIndex);
                    }}
                  >
                    {catalogLabel(sub.name, locale)} <small>({sub.count})</small>
                  </span>
                  <strong className={sub.total >= 0 ? "is-income" : "is-expense"}>{unsignedMoney(symbol, sub.total)}</strong>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {expanded && connectors.length > 0 && (
       <svg className="stats-split-connectors" aria-hidden="true">
          {connectors.map((connector, index) => (
           <g key={index}>
            <path d={connector.d} fill="none" stroke={connector.color} strokeDasharray="3 5" strokeLinecap="round" />
             <circle cx={connector.x} cy={connector.y} r={2} fill={connector.color} />
             <circle cx={connector.endX} cy={connector.endY} r={2.4} fill={connector.color} />
           </g>
          ))}
          {connectors.map((connector, index) =>
            connector.label ? (
              <text key={`label-${index}`} x={(connector.x + connector.endX) / 2} y={connector.endY - 3} textAnchor="middle">{connector.label}</text>
            ) : null,
          )}
        </svg>
      )}
    </li>
  );
}

function TasksPanel({ tasks, locale }: { tasks: ReturnType<typeof aggregateTaskStats>; locale: Locale }) {
  if (tasks.entries.length === 0) return <section className="stats-card panel"><p className="stats-empty">{t("statsNoTasks", locale)}</p></section>;
  const maxMinutes = tasks.categories.reduce((max, category) => Math.max(max, category.totalMinutes), 0);

  return (
    <>
      <div className="stats-kpi-row stats-kpi-row--headline">
        <Kpi label={t("completionRate", locale)} value={`${Math.round(tasks.rate)}%`} />
        <Kpi label={t("statsTotalLabel", locale)} value={formatMinutes(tasks.totalMinutes)} />
        <Kpi label={t("statsLongest", locale)} value={formatMinutes(tasks.longestMinutes)} />
        <Kpi label={t("statsTimed", locale)} value={`${tasks.timedCount}/${tasks.entries.length}`} />
      </div>

      <section className="stats-card panel">
        <header className="stats-card-header"><h3><Icon name="target" size={16} /> {t("statsCoreMetrics", locale)}</h3></header>
        <div className="stats-status-row">
          <span className="status-chip status-open">{t("statsOpen", locale)} · {tasks.open}</span>
          <span className="status-chip status-progress">{t("statsInProgress", locale)} · {tasks.inProgress}</span>
          <span className="status-chip status-done">{t("statsDone", locale)} · {tasks.done}</span>
          <span className="status-chip status-cancelled">{t("statsCancelled", locale)} · {tasks.cancelled}</span>
        </div>
        <div className="stats-progress" role="img" aria-label={`${t("completionRate", locale)} ${Math.round(tasks.rate)}%`}>
          <i style={{ width: `${Math.max(2, tasks.rate)}%` }} />
        </div>
      </section>

      <section className="stats-card panel">
        <header className="stats-card-header"><h3><Icon name="clock" size={16} /> {t("statsDurationByCategory", locale)}</h3></header>
        <ul className="stats-category-list">
          {tasks.categories.map((category) => (
            <li key={category.id}>
              <div className="stats-category-row is-static">
                <FadeText className="stats-category-name">
                  <i style={{ background: category.color }} />
                  {categoryLabel(category.id, locale, catalogLabel(category.id, locale, category.name))} <small>({category.count})</small>
                </FadeText>
                <span className="stats-category-bar">
                  <i style={{ width: `${maxMinutes > 0 ? (category.totalMinutes / maxMinutes) * 100 : 0}%`, background: category.color }} />
                </span>
                <span className="stats-category-share">{t("statsLongest", locale)} {formatMinutes(category.longestMinutes)}</span>
                <strong>{formatMinutes(category.totalMinutes)}</strong>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function BillsReview({
  series,
  buckets,
  labels,
  expense,
  symbol,
  locale,
  granularity,
  bills,
  onOpenDate,
}: {
  series: ReviewChartSeries[];
  buckets: ReviewBucket[];
  labels: string[];
  expense: { current: number; previous: number; delta: number };
  symbol: string;
  locale: Locale;
  granularity: ReviewGranularity;
  bills: ReturnType<typeof aggregateBillStats>;
  onOpenDate?: (date: string) => void;
}) {
  const topBills = [...bills.expenseEntries].sort((left, right) => Math.abs(right.amount ?? 0) - Math.abs(left.amount ?? 0)).slice(0, 5);

  return (
    <>
      <div className="stats-kpi-row">
        <Kpi label={t("statsExpense", locale)} value={money(symbol, expense.current)} tone="expense" />
        <DeltaKpi value={expense} locale={locale} invert format={(value) => money(symbol, value)} />
      </div>
      {bills.count > 0 ? (
        <ReviewLineChart
          key={granularity + ":" + buckets[0]?.date + ":" + buckets.at(-1)?.date}
          buckets={buckets}
          labels={labels}
          series={series}
          ariaLabel={t("reviewCashFlow", locale)}
          granularity={granularity}
          locale={locale}
          formatValue={(value) => unsignedMoney(symbol, value)}
          onOpenDate={onOpenDate}
        />
      ) : (
        <p className="stats-empty">{t("statsNoBills", locale)}</p>
      )}
      {topBills.length > 0 && (
        <ul className="stats-match-list">
          {topBills.map((entry) => {
            const [primaryCat, subCat] = (entry.category || "uncategorized").split("/");
            const cat = bills.categories.find((c) => c.id.toLocaleLowerCase() === primaryCat.toLocaleLowerCase() || c.name.toLocaleLowerCase() === primaryCat.toLocaleLowerCase());
            const catColor = cat?.color ?? entry.color ?? "var(--accent)";
            const catName = cat ? categoryLabel(cat.id, locale, catalogLabel(cat.id, locale, cat.name)) : primaryCat;
            const subName = subCat ? catalogLabel(subCat, locale) : null;
            return (
            <li key={`${entry.id}:${entry.date}`}>
              <button type="button" onClick={() => onOpenDate?.(entry.date)}>
                <span className="stats-match-date">{entry.date}</span>
                <span className="stats-match-title">{entry.title}</span>
                <span className="stats-match-cat">
                  <i style={{ background: catColor }} />
                  {catName}{subName ? ` / ${subName}` : ""}
                </span>
                <span className="is-expense">{money(symbol, Math.abs(entry.amount ?? 0))}</span>
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function DeltaKpi({ value, locale, invert = false, format }: { value: { current: number; previous: number; delta: number }; locale: Locale; invert?: boolean; format: (input: number) => string }) {
  return (
    <div className="stats-kpi">
      <small>{t("reviewDelta", locale)}</small>
      <DeltaBadge value={value} locale={locale} invert={invert} format={format} />
    </div>
  );
}

function TasksReview({
  series,
  review,
  buckets,
  labels,
  locale,
  settings,
  granularity,
  onToggle,
  onStatus,
  overdue,
  upcoming,
  onOpenDate,
}: {
  series: ReviewChartSeries[];
  review: ReturnType<typeof buildReview>;
  buckets: ReviewBucket[];
  labels: string[];
  locale: Locale;
  settings: ChronoEonSettings;
  granularity: ReviewGranularity;
  onToggle?: (id: string, entry?: Entry) => void;
  onStatus?: (entry: Entry, status: EntryStatus) => void;
  overdue: Entry[];
  upcoming: Entry[];
  onOpenDate?: (date: string) => void;
}) {

  return (
    <>
      <div className="stats-kpi-row">
        <Kpi label={t("completionRate", locale)} value={`${Math.round(review.tasks.rate.current)}%`} />
        <DeltaKpi value={review.tasks.rate} locale={locale} format={(value) => `${Math.round(value)}%`} />
      </div>
      <ReviewLineChart
        key={granularity + ":" + buckets[0]?.date + ":" + buckets.at(-1)?.date}
        buckets={buckets}
        labels={labels}
        series={series}
        ariaLabel={t("reviewScheduleLoad", locale)}
        granularity={granularity}
        locale={locale}
        formatValue={(value) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        onOpenDate={onOpenDate}
      />
      <div className="review-columns">
        <section className="stats-card panel">
          <header className="stats-card-header">
            <h3><Icon name="inbox" size={16} /> {t("reviewCarriedOver", locale)}</h3>
            <span className="stats-card-total">{overdue.length}</span>
          </header>
          <TaskSummaryList
            entries={overdue.slice(0, 30)}
            locale={locale}
            settings={settings}
            emptyLabel={t("reviewNothingCarried", locale)}
            onToggle={onToggle ?? (() => undefined)}
            onStatus={onStatus}
            onOpen={(entry) => onOpenDate?.(entry.date)}
          />
          {upcoming.length > 0 && (
            <>
              <div className="task-summary-divider"><span>{t("reviewUpcoming", locale)}</span></div>
              <TaskSummaryList
                entries={upcoming.slice(0, 30)}
                locale={locale}
                settings={settings}
                emptyLabel={t("reviewNothingUpcoming", locale)}
                onToggle={onToggle ?? (() => undefined)}
                onStatus={onStatus}
                onOpen={(entry) => onOpenDate?.(entry.date)}
              />
            </>
          )}
        </section>

        <section className="stats-card panel">
          <header className="stats-card-header">
            <h3><Icon name="check" size={16} /> {t("reviewHighlights", locale)}</h3>
            <span className="stats-card-total">{review.highlights.length}</span>
          </header>
          <TaskSummaryList
            entries={review.highlights.slice(0, 30)}
            locale={locale}
            settings={settings}
            emptyLabel={t("reviewNoHighlights", locale)}
            onToggle={onToggle ?? (() => undefined)}
            onStatus={onStatus}
            onOpen={(entry) => onOpenDate?.(entry.date)}
          />
        </section>
      </div>
    </>
  );
}
