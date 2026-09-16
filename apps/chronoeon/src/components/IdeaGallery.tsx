import { useEffect, useRef, useState } from "react";
import type { Locale } from "@chronoeon/domain";
import { t } from "../i18n";
import { AttachmentThumb } from "./AttachmentThumb";
import { openImagePreview } from "./photoPreviewBus";

interface IdeaGalleryProps {
  images: string[];
  locale: Locale;
}

export const IDEA_THUMB = 68;
const GAP = 6;
const NAV = 20;
const NAV_GAP = 4;

/**
 * One centred row of thumbnails. When the row cannot hold every photo the
 * ends grow slim ‹ › buttons and the row becomes a loop, so a card never grows
 * taller than one strip of photos however many were attached.
 */
export function IdeaGallery({ images, locale }: IdeaGalleryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Seed from the layout box first so the observer's first sample wins when
    // both fire (jsdom reports a 0 clientWidth and only the observer knows).
    if (element.clientWidth > 0) setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setOffset(0); }, [images.length]);

  const fits = (available: number) => Math.max(1, Math.floor((available + GAP) / (IDEA_THUMB + GAP)));
  const paged = width > 0 && fits(width) < images.length;
  const visible = paged ? fits(width - 2 * (NAV + NAV_GAP)) : images.length;
  const shown = paged
    ? Array.from({ length: Math.min(visible, images.length) }, (_, index) => images[(offset + index) % images.length])
    : images;
  const step = (direction: 1 | -1) => setOffset((current) => (current + direction + images.length) % images.length);

  return (
    <div className={`idea-gallery${paged ? " is-paged" : ""}`} ref={ref}>
      {paged && <button type="button" className="idea-gallery-nav" onClick={() => step(-1)} aria-label={t("previous", locale)}>‹</button>}
      <ul>
        {shown.map((reference) => (
          <li key={reference} data-reference={reference}>
            <button
              type="button"
              className="idea-gallery-open"
              onClick={() => openImagePreview(images, images.indexOf(reference))}
              aria-label={`${t("photoPreview", locale)} · ${reference}`}
              title={t("photoPreview", locale)}
            >
              <AttachmentThumb locale={locale} reference={reference} />
            </button>
          </li>
        ))}
      </ul>
      {paged && <button type="button" className="idea-gallery-nav" onClick={() => step(1)} aria-label={t("next", locale)}>›</button>}
    </div>
  );
}
