import { format, parseISO } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { resolveEntryColors } from "@chronoeon/domain";
import { titleFor, type ChronoEonSettings, type Locale } from "../domain/entry";
import type { DayPhotoGroup } from "../hooks/useDayPhotos";
import { categoryOptionsForKind } from "@chronoeon/domain";
import { categoryLabel, t } from "../i18n";
import { PhotoFrame } from "./PhotoFrame";

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
              const categoryOption = categoryOptionsForKind(entry.kind, settings, entry.calendar)
                .find((option) => option.value === entry.category);
              const category = categoryLabel(entry.category, locale, categoryOption?.label, settings);
              return <PhotoFrame key={group.id} title={title} note={entry.note} location={entry.location} urls={group.urls} locale={locale} kind={entry.kind} category={category} accent={accent} />;
            })}
          </div>
        </section>
      ) : null)}
    </div>
  );
}
