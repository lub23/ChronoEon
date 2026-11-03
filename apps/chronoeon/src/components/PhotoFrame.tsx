import type { EntryKind, Locale } from "@chronoeon/domain";
import { t } from "../i18n";
import { LocationGlyph } from "./ItemGlyph";
import { openImagePreview } from "./photoPreviewBus";

/** The same stacked photo frame and caption on the timeline and the map. */
export function PhotoFrame({ title, note, location, urls, locale, kind, category, accent, meta }: {
  title: string; note?: string; location?: string; urls: string[]; locale: Locale;
  kind: EntryKind | "item"; category: string; accent: string; meta?: string;
}) {
  const sheets = urls.slice(0, 3);
  return <article className="photo-wall-item">
    <button type="button" className={`photo-wall-stack sheets-${sheets.length}`} onClick={() => openImagePreview(urls, 0)} aria-label={`${t("photoPreview", locale)} · ${title}`} title={t("photoPreview", locale)}>
      {sheets.map((url, index) => <span key={`${url}-${index}`} className={`photo-wall-sheet sheet-${index}`}><img src={url} alt="" loading="lazy" /></span>)}
    </button>
    <div className="photo-wall-caption"><strong className="photo-wall-title">
      <i className={`photo-wall-dot is-${kind}`} title={t(kind === "item" ? "items" : kind, locale)} aria-hidden="true" />
      <i className="photo-wall-dot is-category" style={{ background: accent }} title={category} aria-hidden="true" /><span>{title}</span>
    </strong>{meta && <small className="photo-wall-meta">{meta}</small>}{note && <p className="photo-wall-note">{note}</p>}
    {location && <span className="photo-wall-location" title={location}><LocationGlyph size={10} /><span>{location}</span></span>}
    </div>
  </article>;
}
