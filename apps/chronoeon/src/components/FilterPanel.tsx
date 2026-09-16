import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createMotionPortal as createPortal } from "./MotionPresence";
import { EMPTY_ENTRY_FILTER, filterActive, toggleValue, type EntryFilter } from "../domain/entryFilter";
import type { AgendaFilter } from "../domain/agendaTimeline";
import type { Entry, EntryKind, Locale } from "../domain/entry";
import type { ChronoEonSettings, EntryCategoryOption } from "@chronoeon/domain";
import { calendarDisplayName, t } from "../i18n";
import { Icon } from "./Icon";
import { SearchResults } from "./SearchResults";
import { registerModalDismiss } from "./modalLayer";

interface FilterPanelProps {
  locale: Locale;
  kind: AgendaFilter;
  filter: EntryFilter;
  scheduleCategories: EntryCategoryOption[];
  billCategories: EntryCategoryOption[];
  calendars: Array<{ id: string; name: string }>;
  anchor: { top: number; bottom: number; right: number };
  settings: ChronoEonSettings;
  entries: Entry[];
  search: string;
  focusSearch?: boolean;
  onSearch: (value: string) => void;
  onOpenEntry: (entry: Entry) => void;
  onKindChange: (filter: AgendaFilter) => void;
  onChange: (filter: EntryFilter) => void;
  onClose: () => void;
}
const KIND_OPTIONS: Array<{ id: EntryKind; label: "tasks" | "events" | "bills" | "ideas" }> = [
  { id: "task", label: "tasks" }, { id: "event", label: "events" },
  { id: "bill", label: "bills" }, { id: "idea", label: "ideas" },
];

/** One surface for text, calendars, kinds, photos and category filters. */
export function FilterPanel({ locale, kind, filter, scheduleCategories, billCategories, calendars, anchor,
  settings, entries, search, focusSearch, onSearch, onOpenEntry, onKindChange, onChange, onClose }: FilterPanelProps) {
  const [query, setQuery] = useState(search);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => registerModalDismiss(event => { event.preventDefault(); closeRef.current(); }), []);
  useEffect(() => { if (focusSearch) { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); } }, [focusSearch]);
  useEffect(() => setQuery(search), [search]);

  // Each group owns its selection; identical category names across kinds never
  // toggle each other. Unknown stored values remain visible in their own group.
  const schedule = [...scheduleCategories, ...(filter.categories ?? []).filter(value => !scheduleCategories.some(option => option.value === value)).map(value => ({ value, label: value }))];
  const bills = [...billCategories, ...(filter.billCategories ?? []).filter(value => !billCategories.some(option => option.value === value)).map(value => ({ value, label: value.split("/").at(-1)!, group: value.split("/")[0] }))];
  const scheduleValues = schedule.map(option => option.value);
  const billValues = bills.map(option => option.value);
  const selection = (bill: boolean) => bill ? filter.billCategories ?? billValues : filter.categories ?? scheduleValues;
  const changeCategories = (next: string[], bill: boolean) => {
    const values = bill ? billValues : scheduleValues;
    onChange({ ...filter, [bill ? "billCategories" : "categories"]: values.every(value => next.includes(value)) ? null : next });
  };
  const billGroups = new Map<string, EntryCategoryOption[]>();
  for (const option of bills) {
    const group = option.group ?? option.value;
    billGroups.set(group, [...(billGroups.get(group) ?? []), option]);
  }
  const categoryChip = (option: EntryCategoryOption, bill = false) => <button key={option.value} type="button"
    className={selection(bill).includes(option.value) ? "filter-chip is-active" : "filter-chip"}
    aria-pressed={selection(bill).includes(option.value)} onClick={() => changeCategories(toggleValue(selection(bill), option.value), bill)}>
    {option.color && <i aria-hidden="true" style={{ color: option.color }} />}{option.label ?? option.value}
  </button>;
  const groupToggle = (options: EntryCategoryOption[], bill = false) => {
    const selected = selection(bill);
    const values = options.map(option => option.value);
    const all = values.every(value => selected.includes(value));
    return <button type="button" className="filter-select-all" onClick={() => changeCategories(all
      ? selected.filter(value => !values.includes(value)) : [...new Set([...selected, ...values])], bill)}>
      {t(all ? "filterDeselectAll" : "filterSelectAll", locale)}
    </button>;
  };
  const calendarIds = [...new Set([...filter.calendarIds, ...calendars.map(item => item.id)])];
  const calendarChecked = (id: string) => filter.calendarIds.length === 0 || filter.calendarIds.includes(id);
  const toggleCalendar = (id: string) => {
    const current = filter.calendarIds.length ? filter.calendarIds : calendarIds;
    if (current.length === 1 && current.includes(id)) return;
    const next = toggleValue(current, id);
    onChange({ ...filter, calendarIds: next.length === calendarIds.length ? [] : next });
  };
  const above = anchor.bottom > window.innerHeight * .55;
  const width = Math.min(380, window.innerWidth - 16);
  const style = {
    "--filter-left": Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)) + "px",
    "--filter-top": Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - 96)) + "px",
    ...(above ? { "--filter-bottom": Math.max(8, window.innerHeight - anchor.top + 8) + "px" } : {}),
  } as CSSProperties;
  const active = filterActive(filter) || kind.length > 0 || Boolean(search.trim());

  return createPortal(<div className={above ? "filter-panel-backdrop filter-panel-backdrop--above" : "filter-panel-backdrop"}
    role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={above ? "filter-panel is-above" : "filter-panel"} role="dialog" aria-modal="true"
      aria-label={t("filterPanelTitle", locale)} style={style} onPointerDown={event => event.stopPropagation()}>
      <header className="filter-panel-header">
        <strong>{t("filterPanelTitle", locale)}</strong>
        <button type="button" role="checkbox" aria-checked={filter.photosOnly}
          className={filter.photosOnly ? "filter-check filter-photos is-checked" : "filter-check filter-photos"}
          onClick={() => onChange({ ...filter, photosOnly: !filter.photosOnly })}>
          <i aria-hidden="true"><Icon name="check" size={11} /></i>{t("filterPhotosOnly", locale)}
        </button>
      </header>
      <div className="filter-section filter-search-section">
        <div className="filter-section-heading"><p className="filter-label">{t("filterSearch", locale)}</p>
          {active && <button type="button" className="filter-clear" onClick={() => {
            onChange(EMPTY_ENTRY_FILTER); onKindChange([]); onSearch(""); setQuery("");
          }}><Icon name="close" size={11} />{t("filterReset", locale)}</button>}
        </div>
        <form className="filter-search-form" onSubmit={event => { event.preventDefault(); onSearch(query.trim()); inputRef.current?.blur(); }}>
          <label><Icon name="search" size={14} /><input ref={inputRef} type="search" value={query}
            onChange={event => setQuery(event.target.value)} placeholder={t("filterSearchHint", locale)} aria-label={t("filterSearch", locale)} /></label>
          <button type="submit" className="filter-search-submit">{t("filterSearch", locale)}</button>
        </form>
        <SearchResults entries={entries} search={search} settings={settings} locale={locale} onOpen={entry => { onClose(); onOpenEntry(entry); }} />
      </div>
      <div className="filter-section">
        <p className="filter-label">{t("filterCalendars", locale)}</p>
        {!calendarIds.length && <p className="filter-empty">{t("filterNoOptions", locale)}</p>}
        <div className="filter-chips">{calendarIds.map(id => <button key={id} type="button" role="checkbox" aria-checked={calendarChecked(id)}
          className={calendarChecked(id) ? "filter-check is-checked" : "filter-check"} onClick={() => toggleCalendar(id)}>
          <i aria-hidden="true"><Icon name="check" size={11} /></i>{calendarDisplayName(calendars.find(item => item.id === id)?.name ?? id, locale)}
        </button>)}</div>
      </div>
      <div className="filter-section">
        <p className="filter-label">{t("type", locale)}</p>
        <div className="filter-chips">{KIND_OPTIONS.map(option => {
          const checked = !kind.length || kind.includes(option.id);
          const last = kind.length === 1 && kind[0] === option.id;
          return <button key={option.id} type="button" role="checkbox" aria-checked={checked} disabled={last}
            className={checked ? "filter-check is-checked" : "filter-check"} onClick={() => {
              const next = toggleValue(kind.length ? kind : KIND_OPTIONS.map(item => item.id), option.id);
              onKindChange(next.length === KIND_OPTIONS.length ? [] : next);
            }}><i aria-hidden="true"><Icon name="check" size={11} /></i>{t(option.label, locale)}</button>;
        })}</div>
      </div>
      <div className="filter-section">
        <p className="filter-label">{t("filterCategories", locale)}</p>
        {!schedule.length && !bills.length && <p className="filter-empty">{t("filterNoOptions", locale)}</p>}
        <div className="filter-category-groups">
          {schedule.length > 0 && <section className="filter-category-section">
            <div className="filter-section-heading"><p className="filter-label">{t("filterScheduleCategories", locale)}</p>{groupToggle(schedule)}</div>
            <div className="filter-chips">{schedule.map(option => categoryChip(option))}</div>
          </section>}
          {bills.length > 0 && <section className="filter-category-section">
            <div className="filter-section-heading"><p className="filter-label">{t("filterBillCategories", locale)}</p>{groupToggle(bills, true)}</div>
            {[...billGroups].map(([group, options]) => <section key={group}><small>{group}</small><div className="filter-chips">{options.map(option => categoryChip(option, true))}</div></section>)}
          </section>}
        </div>
      </div>
    </section>
  </div>, document.body);
}
