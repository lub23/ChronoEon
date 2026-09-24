import { useEffect, useMemo, useRef, useState } from "react";

interface DayPhotoBackgroundProps {
  images: string[];
  intervalMs?: number;
  className?: string;
  onOpen?: () => void;
  openLabel?: string;
}
const FADE_MS = 1200;

/** Two local image layers: decode the incoming photo before fading it over an
 * opaque current photo. Fading both out/in dims the entire calendar at midpoint. */
export function DayPhotoBackground({ images, intervalMs = 7000, className, onOpen, openLabel }: DayPhotoBackgroundProps) {
  const photos = useMemo(() => [...new Set(images)], [images]);
  const seed = useMemo(() => {
    let hash = 0;
    for (const character of (photos[0] ?? "").slice(-128)) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return Math.abs(hash);
  }, [photos[0]]);
  const [current, setCurrent] = useState(() => photos[seed % photos.length] ?? "");
  const [incoming, setIncoming] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const incomingRef = useRef<HTMLImageElement>(null);
  const shown = photos.includes(current) ? current : photos[seed % photos.length] ?? "";

  useEffect(() => {
    if (shown === current) return;
    setCurrent(shown); setIncoming(null); setFading(false);
  }, [shown, current]);

  useEffect(() => {
    if (photos.length <= 1 || incoming) return;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        setIncoming(photos[(photos.indexOf(shown) + 1) % photos.length]);
      }, intervalMs + seed % Math.max(1, Math.round(intervalMs * .2)));
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [photos, shown, incoming, intervalMs, seed]);

  useEffect(() => {
    const image = incomingRef.current;
    if (!incoming || !image) return;
    let disposed = false;
    let revealing = false;
    let frame = 0;
    let timer = 0;
    const promote = () => {
      if (disposed) return;
      setCurrent(incoming); setIncoming(null); setFading(false);
    };
    const loaded = async () => {
      if (revealing || disposed) return;
      revealing = true;
      try { await image.decode?.(); } catch { if (!disposed) setIncoming(null); return; }
      if (disposed) return;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { promote(); return; }
      // Allow a zero-opacity paint even when the decoded image was cached.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          setFading(true);
          timer = window.setTimeout(promote, FADE_MS + 50);
        });
      });
    };
    const failed = () => { if (!disposed) setIncoming(null); };
    const ended = (event: TransitionEvent) => { if (event.propertyName === "opacity") promote(); };
    image.addEventListener("load", loaded, { once: true });
    image.addEventListener("error", failed, { once: true });
    image.addEventListener("transitionend", ended);
    if (image.complete && image.naturalWidth > 0) void loaded();
    return () => {
      disposed = true; cancelAnimationFrame(frame); window.clearTimeout(timer);
      image.removeEventListener("load", loaded); image.removeEventListener("error", failed);
      image.removeEventListener("transitionend", ended);
    };
  }, [incoming]);

  if (!shown) return null;
  const next = photos.length > 1 ? photos[(photos.indexOf(shown) + 1) % photos.length] : shown;
  const frames = incoming && incoming !== shown
    ? [shown, incoming]
    : shown === next ? [shown] : [shown, next];
  return <>
    <span className={className ? `day-photo-bg ${className}` : "day-photo-bg"} aria-hidden="true">
      <span className="day-photo-images">{frames.map((url, index) => <img key={index} src={url} alt="" draggable={false}
        ref={url === incoming ? incomingRef : undefined}
        className={url === incoming
          ? `day-photo-frame is-incoming${fading ? " is-ready" : ""}`
          : index === 0 ? "day-photo-frame is-current" : "day-photo-frame is-standby"} />)}</span>
      <span className="day-photo-scrim" />
    </span>
    {onOpen && <button type="button" className="day-photo-open" aria-label={openLabel} title={openLabel}
      onClick={event => { event.stopPropagation(); onOpen(); }} />}
  </>;
}
