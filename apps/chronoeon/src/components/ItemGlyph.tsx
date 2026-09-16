// Unified item glyphs.
//
// Every modality/status marker draws inside the SAME 24×24 viewBox and is
// rendered at one of two canonical sizes, so a task checkbox, an event clock
// and a bill coin line up pixel-for-pixel wherever they sit in the same slot:
// month chips, week/day chips, list rows and overflow popovers. Colors follow
// `currentColor`, so a glyph inherits the chip's contrast-safe label color.

import type { CSSProperties, ReactNode } from "react";
import type { EntryKind, EntryStatus } from "../domain/entry";

/** Primary modality / status marker. One constant keeps every view aligned. */
export const CHIP_ICON_SIZE = 14;
/** Secondary metadata markers (camera, pin, repeat, bell). */
export const CHIP_META_ICON_SIZE = 12;

interface GlyphProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

function svgProps(size: number, className?: string, style?: CSSProperties, title?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    xmlns: "http://www.w3.org/2000/svg",
    className,
    style: { display: "block", flexShrink: 0, ...style } as CSSProperties,
    "aria-hidden": title ? undefined : true,
    role: title ? "img" : undefined,
  };
}

/** Shared rounded-square frame so all four task statuses read as one object. */
const STATUS_FRAME = <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="4.75" />;

/**
 * Task-status checkbox. The frame never changes; only the interior conveys
 * state, which is why "todo" reads as an empty box rather than a foreign shape.
 */
export function TaskStatusGlyph({ status = "open", size = CHIP_ICON_SIZE, className, style, title }: GlyphProps & { status?: EntryStatus }) {
  let interior: ReactNode = null;
  let frameFill = "none";
  let frameFillOpacity = 1;

  if (status === "done") {
    frameFill = "currentColor";
    frameFillOpacity = 0.26;
    interior = <path d="M7.5 12.3l3 3 6-6.6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />;
  } else if (status === "in-progress") {
    interior = <path d="M12 4.5 A7.5 7.5 0 0 0 12 19.5 Z" fill="currentColor" stroke="none" />;
  } else if (status === "cancelled") {
    interior = <path d="M8.7 8.7l6.6 6.6M15.3 8.7l-6.6 6.6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />;
  }

  return (
    <svg {...svgProps(size, className, style, title)}>
      {title ? <title>{title}</title> : null}
      <g fill={frameFill} fillOpacity={frameFillOpacity} stroke="currentColor" strokeWidth={2}>{STATUS_FRAME}</g>
      {interior}
    </svg>
  );
}

/** Event marker — a clock, fitting for something that happens at a time. */
export function EventGlyph({ size = CHIP_ICON_SIZE, className, style, title }: GlyphProps) {
  return (
    <svg {...svgProps(size, className, style, title)}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M12 7.4V12l3.1 1.9" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Bill marker — a coin, drawn on the same circle as the event clock. */
export function BillGlyph({ size = CHIP_ICON_SIZE, className, style, title }: GlyphProps) {
  return (
    <svg {...svgProps(size, className, style, title)}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth={2} />
      <path
        d="M9.5 14.2c0 1 .9 1.6 2.4 1.6s2.5-.6 2.5-1.7c0-2.5-4.7-1.3-4.7-3.7 0-1 1-1.7 2.3-1.7s2.3.6 2.3 1.5M12 7.6v1M12 15.8v1"
        fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Currency marks occupy the same circular optical box as item glyphs. The
 * common currencies are drawn rather than typeset so their strokes stay crisp
 * at 14px; custom currency codes fall back to their first letter.
 */
export function CurrencyGlyph({ code, size = CHIP_ICON_SIZE, className, style, title }: GlyphProps & { code: string }) {
  const normalized = code.trim().toUpperCase();
  let mark: ReactNode;
  if (normalized === "CNY") {
    mark = <path d="M7.6 6.2 12 11.7l4.4-5.5M6.9 12h10.2M6.9 15h10.2M12 11.7v6.8" />;
  } else if (normalized === "USD") {
    mark = <path d="M15 8.7c-.5-1-1.5-1.5-3-1.5-1.8 0-3 .8-3 2.2 0 2.8 6.2 1.5 6.2 4.4 0 1.5-1.3 2.3-3.2 2.3-1.6 0-2.7-.6-3.2-1.7M12 5.4v13.2" />;
  } else if (normalized === "EUR") {
    mark = <path d="M16.3 7.7A5.7 5.7 0 0 0 7 12a5.7 5.7 0 0 0 9.3 4.3M6 10.4h7M6 13.6h7" />;
  } else if (normalized === "GBP") {
    mark = <path d="M14.8 7.3a2.9 2.9 0 0 0-5 2.1c0 1.4.8 2.2 1.4 3.2.5.9.6 1.8-.1 2.9H17M7.6 15.5H16" />;
  } else if (normalized === "JPY") {
    mark = <path d="M7.4 5.8 12 11.5l4.6-5.7M6.9 10.8h10.2M6.9 14h10.2M12 11.5v7" />;
  } else {
    mark = (
      <text x="12" y="16.4" textAnchor="middle" fontSize="11" fontWeight={700} fill="currentColor" stroke="none" fontFamily="var(--font-sans)">
        {(normalized || "?").slice(0, 1)}
      </text>
    );
  }

  return (
    <svg {...svgProps(size, className, style, title)}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth={2} />
      <g fill="none" stroke="currentColor" strokeWidth={1.55} strokeLinecap="round" strokeLinejoin="round">{mark}</g>
    </svg>
  );
}

/** Idea marker — a lamp on the same optical weight as the other three. */
export function IdeaGlyph({ size = CHIP_ICON_SIZE, className, style, title }: GlyphProps) {
  return (
    <svg {...svgProps(size, className, style, title)}>
      {title ? <title>{title}</title> : null}
      <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.2 17.6h5.6M10.4 20.6h3.2" />
        <path d="M8.3 14.6A6.8 6.8 0 1 1 15.7 14.6c-1 .7-1.6 1.8-1.6 3.05h-3.8c0-1.25-.6-2.35-1.6-3.05Z" />
      </g>
    </svg>
  );
}

/** Location pin, prefixing a place label. */
export function LocationGlyph({ size = CHIP_META_ICON_SIZE, className, style, title }: GlyphProps) {
  return (
    <svg {...svgProps(size, className, style, title)}>
      {title ? <title>{title}</title> : null}
      <path d="M12 21.5s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      <circle cx="12" cy="10.5" r="2.3" fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

/** Recurrence marker — two chasing arrows, monochrome so it never shouts. */
export function RepeatGlyph({ size = CHIP_META_ICON_SIZE, className, style, title }: GlyphProps) {
  return (
    <svg {...svgProps(size, className, style, title)}>
      {title ? <title>{title}</title> : null}
      <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="17 1.5 21 5.5 17 9.5" />
        <path d="M3 11.5v-1a4 4 0 0 1 4-4h14" />
        <polyline points="7 22.5 3 18.5 7 14.5" />
        <path d="M21 12.5v1a4 4 0 0 1-4 4H3" />
      </g>
    </svg>
  );
}

/** Camera badge — shown when an entry carries photos. */
export function CameraGlyph({ size = CHIP_META_ICON_SIZE, className, style, title }: GlyphProps) {
  return (
    <svg {...svgProps(size, className, style, title)}>
      {title ? <title>{title}</title> : null}
      <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </g>
    </svg>
  );
}

/** Reminder bell badge. */
export function BellGlyph({ size = CHIP_META_ICON_SIZE, className, style, title }: GlyphProps) {
  return (
    <svg {...svgProps(size, className, style, title)}>
      {title ? <title>{title}</title> : null}
      <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18.5 15.5a6.5 6.5 0 0 0-13 0L4 18.8h16Z" />
        <path d="M10 21.4h4M12 2.6v1.7" />
      </g>
    </svg>
  );
}

/**
 * The modality marker for an entry, at the canonical chip size. Tasks carry
 * their status; the other three modalities have one glyph each.
 */
export function EntryGlyph({ kind, status, size = CHIP_ICON_SIZE, title }: { kind: EntryKind; status?: EntryStatus } & GlyphProps) {
  if (kind === "task") return <TaskStatusGlyph status={status ?? "open"} size={size} title={title} />;
  if (kind === "bill") return <BillGlyph size={size} title={title} />;
  if (kind === "idea") return <IdeaGlyph size={size} title={title} />;
  return <EventGlyph size={size} title={title} />;
}
