import { useEffect, useMemo, useState } from "react";
import { resolveEntryColors, type ChronoEonSettings, type Item } from "@chronoeon/domain";
import { titleFor, type Entry, type Locale } from "../domain/entry";
import { entrySearchMatches, searchExcerpt, itemMatchesSearch } from "../domain/search";
import { categoryLabel, localeTag, t } from "../i18n";
import { EntryGlyph } from "./ItemGlyph";
import { Icon } from "./Icon";

function Highlight({ text, needle, locale }: { text: string; needle: string; locale: Locale }) {
  if (!needle) return <>{text}</>;
  const lower = text.toLocaleLowerCase(localeTag[locale]);
  const query = needle.toLocaleLowerCase(localeTag[locale]);
  const parts = []; let from = 0; let at = lower.indexOf(query);
  while (at >= 0) {
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + query.length)}</mark>);
    from = at + query.length; at = lower.indexOf(query, from);
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

export function SearchResults({ entries, items = [], onOpenItem, search, locale, settings, onOpen }: {
  items?: Item[]; onOpenItem?: (item: Item) => void;
  entries: Entry[]; search: string; locale: Locale; settings: ChronoEonSettings; onOpen: (entry: Entry) => void;
}) {
  const [limit, setLimit] = useState(24);
  useEffect(() => setLimit(24), [search]);
  const matches = useMemo(() => entries.flatMap(entry => {
    const hits = entrySearchMatches(entry, search, locale, settings);
    return hits.length ? [{ entry, hits }] : [];
  }).sort((a, b) => (b.entry.date + (b.entry.start ?? "")).localeCompare(a.entry.date + (a.entry.start ?? ""))), [entries, search, locale, settings]);
  const itemMatches = useMemo(() => items.filter(item => itemMatchesSearch(item, search, locale)), [items, search, locale]);
  const results = [
    ...itemMatches.map(item => ({ kind: "item" as const, item })),
    ...matches.map(match => ({ kind: "entry" as const, ...match })),
  ];
  if (!search.trim()) return null;
  return <div className="filter-search-results" aria-label={t("searchResults", locale)}>
    <div className="filter-results-heading" role="status"><span>{t("searchResults", locale)}</span><small>{matches.length + itemMatches.length} {t("filterSearchCount", locale)}</small></div>
    {!results.length && <p className="filter-empty"><Icon name="search" size={14} />{t("filterNoResults", locale)}</p>}
    <div className="filter-result-list" onKeyDown={event => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(".filter-result");
      if (!buttons.length) return;
      event.preventDefault();
      const active = [...buttons].findIndex(button => button === document.activeElement);
      const next = (active + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
      buttons[next]?.scrollIntoView?.({ block: "nearest" });
    }}>
      {results.slice(0, limit).map(result => {
        if (result.kind === "item") {
          const { item } = result;
          return <button key={`item:${item.id}`} className="filter-result" type="button" onClick={() => onOpenItem?.(item)}><Icon name="box" size={16} /><span className="filter-result-content"><strong>{item.name}</strong><span className="filter-result-meta">{t("items", locale)} · {item.acquiredOn}</span></span><Icon name="chevron-right" size={12} /></button>;
        }
        const { entry, hits } = result;
        const colors = resolveEntryColors(entry, settings);
        const title = titleFor(entry, locale);
        const contexts = hits.filter(hit => hit.field !== "Title" || hit.text !== title).slice(0, 2);
        const needle = search.trim().startsWith("#") ? "" : search.trim();
        const titleMatch = hits.some(hit => hit.field === "Title" && hit.text === title);
        return <button key={`entry:${entry.id}`} className="filter-result" type="button" onClick={() => onOpen(entry)}>
          <span className="filter-result-color" style={{ backgroundColor: colors.fill }} aria-label={categoryLabel(entry.category, locale, undefined, settings)} />
          <span className="filter-result-content">
            <strong className={titleMatch ? "is-match" : undefined}><Highlight text={titleMatch ? searchExcerpt(title, needle, locale, 64) : title} needle={needle} locale={locale} /></strong>
            <span className="filter-result-meta"><EntryGlyph kind={entry.kind} status={entry.status} size={12} />{t(entry.kind, locale)}<span>·</span><time>{entry.date}{entry.start ? " " + entry.start : ""}</time></span>
            {contexts.map((hit, n) => <span className="filter-result-excerpt" key={n}><small>{t(`searchField${hit.field}` as const, locale)}</small><span><Highlight text={searchExcerpt(hit.text, hit.needle, locale)} needle={hit.needle} locale={locale} /></span></span>)}
          </span>
          <Icon name="chevron-right" size={12} />
        </button>;
      })}
    </div>
    {results.length > limit && <button type="button" className="filter-results-more secondary-button" onClick={() => setLimit(current => current + 24)}>{t("filterSearchMore", locale)}</button>}
  </div>;
}
