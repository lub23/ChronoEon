import { useEffect, useMemo, useState } from "react";
import { createMotionPortal as createPortal } from "./MotionPresence";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { resolveAttachmentUrl } from "../platform/attachments";
import { Icon } from "./Icon";
import { registerModalDismiss } from "./modalLayer";

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
 */
export function ImagePreview({ locale, items, index, onIndexChange, onClose }: ImagePreviewProps) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const active = items[index] ?? "";

  useEffect(() => {
    let disposed = false;
    const pending = items.filter((item) => !(item in urls));
    if (!pending.length) return;
    void Promise.all(pending.map(async (item) => [item, await resolveAttachmentUrl(item).catch(() => null)] as const))
      .then((pairs) => {
        if (disposed) return;
        setUrls((current) => {
          const next = { ...current };
          for (const [item, url] of pairs) next[item] = url ?? "";
          return next;
        });
      });
    return () => { disposed = true; };
  }, [items, urls]);

  useEffect(() => registerModalDismiss((event) => {
    event.preventDefault();
    onClose();
  }), [onClose]);

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

  const step = useMemo(() => (direction: 1 | -1) => onIndexChange((index + direction + items.length) % items.length), [index, items.length, onIndexChange]);
  const url = urls[active];

  return createPortal(
    <div
      className="image-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("photoPreview", locale)}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <header className="image-preview-bar">
        <span>{items.length > 1 ? `${index + 1} / ${items.length}` : t("photoPreview", locale)}</span>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("close", locale)} title={t("close", locale)}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="image-preview-stage">
        {items.length > 1 && (
          <button type="button" className="image-preview-nav is-prev" onClick={() => step(-1)} aria-label={t("previous", locale)}>‹</button>
        )}
        {url
          ? <img className="image-preview-image" src={url} alt="" onClick={(event) => event.stopPropagation()} />
          : <span className="image-preview-loading">{url === "" ? t("attachmentMissing", locale) : t("loading", locale)}</span>}
        {items.length > 1 && (
          <button type="button" className="image-preview-nav is-next" onClick={() => step(1)} aria-label={t("next", locale)}>›</button>
        )}
      </div>
    </div>,
    document.body,
  );
}
