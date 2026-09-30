import { useEffect, useMemo, useRef, useState } from "react";

interface DayPhotoBackgroundProps {
  images: string[];
  intervalMs?: number;
  className?: string;
  onOpen?: () => void;
  openLabel?: string;
}
const FADE_MS = 1200;
// One clock per cadence for every visible day. Only the background components
// subscribe: a slideshow tick never rebuilds calendar cells or foreground chips.
const clocks = new Map<number, { listeners: Set<() => void>; timer: number }>();
function subscribeClock(interval: number, listener: () => void) {
  let clock = clocks.get(interval);
  if (!clock) {
    const listeners = new Set<() => void>();
    clock = { listeners, timer: window.setInterval(() => {
      if (!document.hidden) listeners.forEach(tick => tick());
    }, interval) };
    clocks.set(interval, clock);
  }
  clock.listeners.add(listener);
  return () => {
    clock.listeners.delete(listener);
    if (!clock.listeners.size) { window.clearInterval(clock.timer); clocks.delete(interval); }
  };
}

/** Two local image layers: decode the incoming photo before fading it over an
 * opaque current photo. Fading both out/in dims the entire calendar at midpoint. */
export function DayPhotoBackground({ images, intervalMs = 7000, className, onOpen, openLabel }: DayPhotoBackgroundProps) {
  const signature = images.join("\u0000");
  const photos = useMemo(() => [...new Set(signature ? signature.split("\u0000") : [])], [signature]);
  const seed = useMemo(() => {
    let hash = 0;
    for (const character of (photos[0] ?? "").slice(-128)) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return Math.abs(hash);
  }, [photos[0]]);
  const [current, setCurrent] = useState(() => photos[seed % photos.length] ?? "");
  const [incoming, setIncoming] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const incomingRef = useRef<HTMLImageElement>(null);
  const shown = current;

  useEffect(() => {
    if (!photos.length) { setCurrent(""); setIncoming(null); setFading(false); return; }
    if (!photos.includes(current)) {
      setIncoming(photos[seed % photos.length]); setFading(false);
    } else if (incoming && !photos.includes(incoming)) {
      setIncoming(null); setFading(false);
    }
  }, [photos, seed, current]);

  const rotation = useRef(() => {});
  rotation.current = () => {
    if (!incoming) setIncoming(photos[(photos.indexOf(shown) + 1) % photos.length]);
  };
  useEffect(() => {
    if (photos.length <= 1) return;
    return subscribeClock(Math.max(1, intervalMs), () => rotation.current());
  }, [photos.length > 1, intervalMs]);

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

  if (!shown && !incoming) return null;
  const next = photos.length > 1 ? photos[(photos.indexOf(shown) + 1) % photos.length] : shown;
  const frames = incoming && incoming !== shown
    ? [shown, incoming].filter(Boolean)
    : shown === next ? [shown] : [shown, next];
  return <>
    <span className={className ? `day-photo-bg ${className}` : "day-photo-bg"} aria-hidden="true">
      <span className="day-photo-images">{frames.map((url, index) => <img key={url} src={url} alt="" draggable={false}
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
