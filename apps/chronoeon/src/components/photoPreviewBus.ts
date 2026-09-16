/**
 * One shared enlarged-photo viewer for the whole app.
 *
 * Every photo surface (idea cards, the composer's attachments, the day and
 * month photo backdrops, the photo wall) opens the same overlay, so a click
 * always means "show me this bigger" instead of a per-view behaviour. A tiny
 * subscription bus avoids threading a modal host through every view.
 */

export interface ImagePreviewRequest {
  /** Stored attachment references, or already displayable `data:`/`blob:` URLs. */
  items: string[];
  index: number;
}

type Listener = (request: ImagePreviewRequest) => void;

const listeners = new Set<Listener>();

export function openImagePreview(items: string[], index = 0): void {
  const clean = items.filter(Boolean);
  if (!clean.length) return;
  const start = Math.min(Math.max(index, 0), clean.length - 1);
  for (const listener of listeners) listener({ items: clean, index: start });
}

export function subscribeImagePreview(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
