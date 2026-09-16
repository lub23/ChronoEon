import { useEffect, useMemo, useState } from "react";
import { resolveEntryColors, type ChronoEonSettings } from "@chronoeon/domain";
import { titleFor, type Entry, type Locale } from "../domain/entry";
import { entrySearchMatches, searchExcerpt } from "../domain/search";
import { localeTag, t } from "../i18n";
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

export function SearchResults({ entries, search, locale, settings, onOpen }: {
  entries: Entry[]; search: string; locale: Locale; settings: ChronoEonSettings; onOpen: (entry: Entry) => void;
}) {
  const [active, setActive] = useState(0);
  const matches = useMemo(() => entries.flatMap(entry => {
    const hits = entrySearchMatches(entry, search, locale);
    return hits.length ? [{ entry, hits }] : [];
  }).sort((a, b) => (b.entry.date + (b.entry.start ?? "")).localeCompare(a.entry.date + (a.entry.start ?? ""))), [entries, search, locale]);
  const results = matches.slice(0, 24);
  useEffect(() => setActive(0), [search]);
  if (!search.trim()) return null;
  return <div className="filter-search-results" aria-label={t("searchResults", locale)}>
    <div className="filter-results-heading" role="status"><span>{t("searchResults", locale)}</span><small>{matches.length} {t("filterSearchCount", locale)}</small></div>
    {!results.length && <p className="filter-empty"><Icon name="search" size={14} />{t("filterNoResults", locale)}</p>}
    <div className="filter-result-list" onKeyDown={event => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (!results.length) return;
      event.preventDefault();
      const next = (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      setActive(next); event.currentTarget.querySelectorAll<HTMLButtonElement>(".filter-result")[next]?.focus({ preventScroll: true });
      event.currentTarget.querySelectorAll<HTMLButtonElement>(".filter-result")[next]?.scrollIntoView?.({ block: "nearest" });
    }}>
      {results.map(({ entry, hits }, index) => {
        const colors = resolveEntryColors(entry, settings);
        const title = titleFor(entry, locale);
        const contexts = hits.filter(hit => hit.field !== "Title" || hit.text !== title).slice(0, 2);
        const needle = search.trim().startsWith("#") ? "" : search.trim();
        const titleMatch = hits.some(hit => hit.field === "Title" && hit.text === title);
        return <button key={entry.id} className="filter-result" type="button" onFocus={() => setActive(index)} onClick={() => onOpen(entry)}>
          <span className="filter-result-color" style={{ backgroundColor: colors.fill }} aria-label={entry.category} />
          <span className="filter-result-content">
            <strong className={titleMatch ? "is-match" : undefined}><Highlight text={titleMatch ? searchExcerpt(title, needle, locale, 64) : title} needle={needle} locale={locale} /></strong>
            <span className="filter-result-meta"><EntryGlyph kind={entry.kind} status={entry.status} size={12} />{t(entry.kind, locale)}<span>·</span><time>{entry.date}{entry.start ? " " + entry.start : ""}</time></span>
            {contexts.map((hit, n) => <span className="filter-result-excerpt" key={n}><small>{t(`searchField${hit.field}` as const, locale)}</small><span><Highlight text={searchExcerpt(hit.text, hit.needle, locale)} needle={hit.needle} locale={locale} /></span></span>)}
          </span>
          <Icon name="chevron-right" size={12} />
        </button>;
      })}
    </div>
    {matches.length > 24 && <p className="filter-results-limit">{t("filterSearchLimit", locale)}</p>}
  </div>;
}
