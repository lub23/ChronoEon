import { format, parseISO } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { resolveEntryColors } from "@chronoeon/domain";
import { titleFor, type ChronoEonSettings, type Locale } from "../domain/entry";
import type { DayPhotoGroup } from "../hooks/useDayPhotos";
import { categoryLabel, t } from "../i18n";
import { CHIP_META_ICON_SIZE, LocationGlyph } from "./ItemGlyph";
import { openImagePreview } from "./photoPreviewBus";

interface PhotoWallProps {
  locale: Locale;
  settings: ChronoEonSettings;
  /** Visible civil days, in board order. */
  days: string[];
  /** Already-resolved records-with-photos per day. */
  groups: Record<string, DayPhotoGroup[]>;
  onSelectDate?: (key: string) => void;
}

/**
 * Photo appreciation: with "photos only" on, every item chip is hidden and the
 * photos recorded on the visible days are shown large enough to enjoy.
 *
 * One record is one frame. A record with several photos stacks them — the
 * front photo is the one shown, and the ones behind it peek out as tilted
 * corners, so "there is more here" is visible without a count badge. Opening
 * the frame opens that record's whole set.
 */
export function PhotoWall({ locale, settings, days, groups, onSelectDate }: PhotoWallProps) {
  const dateLocale = locale === "zh" ? zhCN : enUS;
  const sections = days.map((key) => {
    const items = groups[key] ?? [];
    return { key, items, count: items.reduce((sum, item) => sum + item.urls.length, 0) };
  });
  const total = sections.reduce((sum, section) => sum + section.count, 0);

  if (!total) return <p className="photo-wall-empty">{t("photoWallEmpty", locale)}</p>;

  return (
    <div className="photo-wall" role="region" aria-label={t("photoWall", locale)}>
      {sections.map(({ key, items, count }) => items.length ? (
        <section key={key} className="photo-wall-day">
          <button type="button" className="photo-wall-date" onClick={() => onSelectDate?.(key)} disabled={!onSelectDate}>
            <strong>{format(parseISO(key), locale === "zh" ? "M月d日 EEE" : "EEE, MMM d", { locale: dateLocale })}</strong>
            <small>{count}</small>
          </button>
          <div className="photo-wall-items">
            {items.map((group) => {
              const entry = group.entry;
              const title = titleFor(entry, locale);
              const { accent } = resolveEntryColors(entry, settings);
              const category = categoryLabel(entry.category, locale) || entry.category;
              // Front sheet first; at most two sheets peek behind it.
              const sheets = group.urls.slice(0, 3);
              return (
                <article key={group.id} className="photo-wall-item">
                  <button
                    type="button"
                    className={`photo-wall-stack sheets-${sheets.length}`}
                    onClick={() => openImagePreview(group.urls, 0)}
                    aria-label={`${t("photoPreview", locale)} · ${title}`}
                    title={t("photoPreview", locale)}
                  >
                    {sheets.map((url, index) => (
                      <span key={`${group.id}-${index}`} className={`photo-wall-sheet sheet-${index}`}>
                        <img src={url} alt="" loading="lazy" />
                      </span>
                    ))}
                  </button>
                  <div className="photo-wall-caption">
                    <strong className="photo-wall-title">
                      <i className={`photo-wall-dot is-${entry.kind}`} title={t(entry.kind, locale)} aria-hidden="true" />
                      <i className="photo-wall-dot is-category" style={{ background: accent }} title={category} aria-hidden="true" />
                      <span>{title}</span>
                    </strong>
                    {entry.note && <p className="photo-wall-note">{entry.note}</p>}
                    {entry.location && (
                      <span className="photo-wall-location" title={entry.location}>
                        <LocationGlyph size={CHIP_META_ICON_SIZE} />
                        <span>{entry.location}</span>
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null)}
    </div>
  );
}
