import { useEffect, useRef, useState } from "react";
import { createMotionPortal as createPortal } from "./MotionPresence";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { resolveAttachmentUrl } from "../platform/attachments";
import { Icon } from "./Icon";
import { useModalDismiss } from "./modalLayer";

interface ImagePreviewProps {
  locale: Locale;
  items: string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/**
 * Full-window photo viewer. References are resolved lazily and cached by the
 * attachment platform, so opening a preview costs one read at most.
 *
 * The layout is a wall: one large photo in the middle with its own set along
 * the bottom, so switching is a direct choice instead of stepping through a
 * strip of half-visible neighbours. The arrows stay for desktop, a swipe moves
 * the main photo on a phone, and a tap that did not travel closes the viewer —
 * the tap the browser synthesises after a swipe is swallowed, so sliding never
 * closes.
 */
export function ImagePreview({ locale, items, index, onIndexChange, onClose }: ImagePreviewProps) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ pointerId: number; startX: number; moved: boolean } | null>(null);
  const suppressTap = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const steppable = items.length > 1;
  const active = items[index] ?? "";
  const url = urls[active];
  const preload = steppable
    ? [items[(index + 1) % items.length], items[(index - 1 + items.length) % items.length]]
      .filter((item, position, list) => Boolean(urls[item]) && list.indexOf(item) === position)
    : [];

  useEffect(() => {
    let disposed = false;
    const pending = items.filter((item) => !(item in urls));
    if (!pending.length) return;
    void Promise.all(pending.map(async (item) => [item, await resolveAttachmentUrl(item).catch(() => null)] as const))
      .then((pairs) => {
        if (disposed) return;
        setUrls((current) => {
          const next = { ...current };
          for (const [item, resolved] of pairs) next[item] = resolved ?? "";
          return next;
        });
      });
    return () => { disposed = true; };
  }, [items, urls]);

  useModalDismiss((event) => {
    event.preventDefault();
    onClose();
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (items.length < 2) return;
      event.preventDefault();
      onIndexChange((index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onIndexChange]);

  const step = (direction: 1 | -1) => onIndexChange((index + direction + items.length) % items.length);

  function endGesture(event: React.PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    gesture.current = null;
    if (!current || current.pointerId !== event.pointerId || !current.moved) return;
    suppressTap.current = true;
    const width = stageRef.current?.clientWidth ?? 0;
    const travelled = dx;
    setDragging(false);
    setDx(0);
    if (steppable && Math.abs(travelled) >= Math.max(48, width * 0.2)) step(travelled < 0 ? 1 : -1);
  }

  return createPortal(
    <div
      className="image-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("photoPreview", locale)}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <header className="image-preview-bar">
        <span>{steppable ? `${index + 1} / ${items.length}` : t("photoPreview", locale)}</span>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("close", locale)} title={t("close", locale)}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="image-preview-stage" ref={stageRef}>
        {steppable && (
          <button type="button" className="image-preview-nav is-prev" onClick={() => step(-1)} aria-label={t("previous", locale)}>‹</button>
        )}
        <div
          className="image-preview-main"
          style={{ transform: `translateX(${dx}px)`, transition: dragging ? "none" : undefined }}
          onPointerDown={(event) => {
            if (event.button !== 0 && event.pointerType !== "touch") return;
            gesture.current = { pointerId: event.pointerId, startX: event.clientX, moved: false };
          }}
          onPointerMove={(event) => {
            const current = gesture.current;
            if (!current || current.pointerId !== event.pointerId || !steppable) return;
            const travel = event.clientX - current.startX;
            if (!current.moved) {
              if (Math.abs(travel) < 8) return;
              current.moved = true;
              setDragging(true);
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }
            setDx(travel);
          }}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onClick={(event) => {
            event.stopPropagation();
            if (suppressTap.current) { suppressTap.current = false; return; }
            onClose();
          }}
        >
          {url
            ? <img key={index} className="image-preview-image" src={url} alt="" draggable={false} />
            : <span className="image-preview-loading">{active in urls ? t("attachmentMissing", locale) : t("loading", locale)}</span>}
        </div>
        {steppable && (
          <button type="button" className="image-preview-nav is-next" onClick={() => step(1)} aria-label={t("next", locale)}>›</button>
        )}
        {preload.map((item, position) => (
          <img key={`${item}-${position}`} className="image-preview-preload" src={urls[item]} alt="" aria-hidden="true" />
        ))}
      </div>
      {steppable && (
        <div className="image-preview-film" role="group" aria-label={t("photoPreview", locale)}>
          {items.map((item, position) => (
            <button
              key={`${item}-${position}`}
              type="button"
              className={position === index ? "image-preview-thumb is-active" : "image-preview-thumb"}
              onClick={() => onIndexChange(position)}
              aria-label={`${position + 1} / ${items.length}`}
              aria-current={position === index}
            >
              {urls[item] ? <img src={urls[item]} alt="" /> : <span className="image-preview-thumb-empty" />}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
