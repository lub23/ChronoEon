import { useMemo } from "react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { resolveEntryColors, type ChronoEonSettings } from "@chronoeon/domain";
import { Virtuoso } from "react-virtuoso";
import type { Entry, Locale } from "../domain/entry";
import { titleFor } from "../domain/entry";
import { calendarDisplayName, t } from "../i18n";
import { entryMatchesSearch } from "../domain/search";
import { Icon } from "./Icon";
import { IdeaGallery } from "./IdeaGallery";
import { IdeaGlyph } from "./ItemGlyph";

interface IdeasViewProps {
  entries: Entry[];
  locale: Locale;
  settings: ChronoEonSettings;
  search: string;
  today: string;
  onEdit: (entry: Entry) => void;
  onConvert: (id: string, today: string) => void;
  onNew: () => void;
}

/** Small boards stay in natural flow. Long boards virtualize pairs of cards
 * as variable-height rows: a uniform-cell grid cannot measure diary paragraphs. */
const VIRTUALIZE_ABOVE = 48;

function calendarNameFor(entry: Entry, settings: ChronoEonSettings): string {
  const id = (entry.calendar ?? "").trim().toLocaleLowerCase();
  const calendar = settings.calendars.find((candidate) => candidate.id.toLocaleLowerCase() === id || candidate.name.toLocaleLowerCase() === id)
    ?? settings.calendars.find((candidate) => candidate.id === settings.defaultCalendarID)
    ?? settings.calendars[0];
  return calendar?.name ?? "";
}

/** First grapheme of the calendar name; Latin initials read better upper-cased. */
function sealInitial(name: string): string {
  const first = [...name.trim()][0] ?? "";
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

export function IdeasView({ entries, locale, settings, search, today, onEdit, onConvert, onNew }: IdeasViewProps) {
  const query = search.trim().toLowerCase();
  const ideas = useMemo(() => entries.filter((entry) => entry.kind === "idea" && (!query || entryMatchesSearch(entry, search, locale))), [entries, query, search, locale]);
  const rows = useMemo(() => Array.from({ length: Math.ceil(ideas.length / 2) }, (_, index) => ideas.slice(index * 2, index * 2 + 2)), [ideas]);
  const dateLocale = locale === "zh" ? zhCN : enUS;
  const virtualize = ideas.length > VIRTUALIZE_ABOVE;

  const ideaCard = (entry: Entry, index: number) => {
    const colors = resolveEntryColors(entry, settings);
    const calendar = calendarDisplayName(calendarNameFor(entry, settings), locale);
    const paragraphs = (entry.note ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const images = entry.images ?? [];
    return (
      <div key={entry.id} className={`idea-vine-node ${index % 2 ? "is-right" : "is-left"}`}>
      <article
        className="idea-card"
        style={{
          "--entry-color": colors.fill,
          "--calendar-color": colors.accent,
        } as React.CSSProperties}
      >
        <div className="idea-card-top">
          <h3><button type="button" className="idea-title-button" onClick={() => onEdit(entry)}>{titleFor(entry, locale)}</button></h3>
          <button type="button" className="idea-card-action" onClick={() => onConvert(entry.id, today)} aria-label={t("convertTask", locale)} title={t("convertTask", locale)}><Icon name="arrow-right" size={15} /></button>
          <button type="button" className="idea-card-action" onClick={() => onEdit(entry)} aria-label={t("edit", locale)} title={t("edit", locale)}><Icon name="edit" size={15} /></button>
        </div>
        <div className={locale === "zh" ? "idea-body is-zh" : "idea-body"}>
          {paragraphs.length > 0 && <button className="idea-body-main" type="button" onClick={() => onEdit(entry)} aria-label={titleFor(entry, locale)}>
            {paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
          </button>}
          <div className="idea-signature">
            <time title={formatDistanceToNow(parseISO(entry.createdAt), { addSuffix: true, locale: dateLocale })}>
              {entry.start
                ? format(parseISO(entry.date), locale === "zh" ? "M月d日" : "MMM d", { locale: dateLocale }) + ` ${entry.start}`
                : format(parseISO(entry.createdAt), locale === "zh" ? "M月d日 HH:mm" : "MMM d HH:mm", { locale: dateLocale })}
            </time>
            {/* A small seal, like the red stamp closing a letter: the calendar
                colour and its initial, without a bar fighting the note. */}
            <span className="idea-seal" title={calendar} aria-label={calendar}>{sealInitial(calendar)}</span>
          </div>
          {images.length > 0 && (
            <>
              <span className="idea-divider" aria-hidden="true" />
              <IdeaGallery images={images} locale={locale} />
            </>
          )}
        </div>
      </article>
      </div>
    );
  };

  return (
    <section className="ideas-page">
      <header className="page-title-row view-title-row">
        <div>
          <h2 className="view-heading"><span className="headline-leaf">{t("ideasTitle", locale)}</span></h2>
        </div>
      </header>

      {ideas.length ? (
        <>
          {virtualize ? (
            <Virtuoso
              className="ideas-scroll"
              data={rows}
              initialItemCount={12}
              computeItemKey={(_index, row) => row[0].id}
              itemContent={(index, row) => <div className="ideas-vine">{row.map((entry, column) => ideaCard(entry, index * 2 + column))}</div>}
            />
          ) : (
            <div className="ideas-vine">{ideas.map((entry, index) => ideaCard(entry, index))}</div>
          )}
          <button className="idea-new-card idea-vine-bud" type="button" onClick={onNew}>
            <span><Icon name="plus" size={21} /></span>
            <strong>{t("newEntry", locale)}</strong>
          </button>
        </>
      ) : query ? (
        <div className="ideas-empty panel" role="status">
          <IdeaGlyph size={38} />
          <strong>{t("filterNoResults", locale)}</strong>
        </div>
      ) : (
        <button className="ideas-empty panel" type="button" onClick={onNew}>
          <IdeaGlyph size={38} />
          <strong>{t("emptyIdeas", locale)}</strong>
          <span>{t("newEntry", locale)}</span>
        </button>
      )}
    </section>
  );
}
