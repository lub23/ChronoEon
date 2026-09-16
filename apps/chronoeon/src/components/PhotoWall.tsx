import { format, parseISO } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { openImagePreview } from "./photoPreviewBus";

interface PhotoWallProps {
  locale: Locale;
  /** Visible civil days, in board order. */
  days: string[];
  /** Already-resolved displayable URLs per day. */
  photos: Record<string, string[]>;
  onSelectDate?: (key: string) => void;
}

/**
 * Photo appreciation: with "photos only" on, every item chip is hidden and the
 * photos recorded on the visible days are shown large enough to enjoy. Each
 * frame opens the shared enlarged viewer.
 */
export function PhotoWall({ locale, days, photos, onSelectDate }: PhotoWallProps) {
  const dateLocale = locale === "zh" ? zhCN : enUS;
  const sections = days.map((key) => ({ key, images: photos[key] ?? [] }));
  const total = sections.reduce((sum, section) => sum + section.images.length, 0);

  if (!total) return <p className="photo-wall-empty">{t("photoWallEmpty", locale)}</p>;

  return (
    <div className="photo-wall" role="region" aria-label={t("photoWall", locale)}>
      {sections.map(({ key, images }) => images.length ? (
        <section key={key} className="photo-wall-day">
          <button type="button" className="photo-wall-date" onClick={() => onSelectDate?.(key)} disabled={!onSelectDate}>
            <strong>{format(parseISO(key), locale === "zh" ? "M月d日 EEE" : "EEE, MMM d", { locale: dateLocale })}</strong>
            <small>{images.length}</small>
          </button>
          <div className="photo-wall-grid">
            {images.map((url, index) => (
              <button
                key={`${key}-${index}`}
                type="button"
                className="photo-wall-frame"
                onClick={() => openImagePreview(images, index)}
                aria-label={`${t("photoPreview", locale)} · ${key}`}
                title={t("photoPreview", locale)}
              >
                <img src={url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </section>
      ) : null)}
    </div>
  );
}
