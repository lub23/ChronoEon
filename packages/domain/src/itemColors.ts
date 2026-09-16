import { readableTextColor } from "./colors";
import type { Entry, EntryKind } from "./entry";
import { resolveEntryColor, type ChronoEonSettings } from "./settings";

/**
 * SINGLE source of truth for an entry's on-screen colors, shared by every
 * renderer in both clients: month chips, week/day blocks, list rows, drag
 * ghosts and overflow popovers.
 *
 * Color resolution used to be copy-pasted per component with subtle
 * divergences — most visibly, a chip could fall back to the *calendar* color
 * whenever the entry sat in the calendar's default category, so the same item
 * rendered brown in Month and light-blue in Day. Centralizing fixes that: the
 * fill always honours the resolved category color, the accent bar always shows
 * the owning calendar, and the label color is always WCAG-picked from the fill.
 */
export interface EntryColors {
  /** Chip / block fill. */
  fill: string;
  /** Left accent bar — always the owning calendar's color. */
  accent: string;
  /** Contrast-safe label color derived from `fill`. */
  text: string;
}

const DEFAULT_ACCENT = "#3b82f6";
const UNCATEGORIZED_FILL = "#8b8b83";

export interface ColorableEntry {
  kind?: EntryKind;
  modality?: EntryKind;
  category?: string;
  calendar?: string;
  calendarId?: string;
  /** A color already resolved by the parser/composer wins over re-resolution. */
  color?: string;
}

function calendarFor(entry: ColorableEntry, settings: ChronoEonSettings) {
  const id = (entry.calendar ?? entry.calendarId ?? "").trim().toLocaleLowerCase();
  return settings.calendars.find((candidate) => candidate.id.toLocaleLowerCase() === id || candidate.name.toLocaleLowerCase() === id)
    ?? settings.calendars.find((candidate) => candidate.id === settings.defaultCalendarID)
    ?? settings.calendars[0];
}

function looksLikeHexColor(value?: string): value is string {
  return Boolean(value && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value));
}

/** Canonical fill color: category, persisted fallback, then calendar color. */
export function resolveEntryFill(entry: ColorableEntry, settings: ChronoEonSettings): string {
  const calendar = calendarFor(entry, settings);
  const kind = entry.kind ?? entry.modality ?? "event";
  const category = entry.category?.trim() || "uncategorized";
  const resolved = resolveEntryColor(category, kind, settings, calendar?.id);
  // An imported legacy row can carry a deliberate custom colour even when its
  // category was removed from the current settings catalog. Preserve that
  // colour, but let a known catalog category always win so settings edits apply
  // consistently in Month, Week, Day, List and drag previews.
  const isUnknownCategory = resolved === UNCATEGORIZED_FILL && category.toLocaleLowerCase() !== "uncategorized";
  if (isUnknownCategory && looksLikeHexColor(entry.color)) return entry.color;
  // An uncategorized bill would otherwise render in the neutral grey that every
  // other uncategorized item uses; give it the calendar's own color instead so
  // bills stay visually distinct from unsorted tasks.
  if (kind === "bill" && resolved === UNCATEGORIZED_FILL) return calendar?.color || resolved;
  return resolved || (looksLikeHexColor(entry.color) ? entry.color : undefined) || calendar?.color || DEFAULT_ACCENT;
}

/** Fill + accent + contrast-safe label color for an entry. */
export function resolveEntryColors(entry: ColorableEntry, settings: ChronoEonSettings): EntryColors {
  const calendar = calendarFor(entry, settings);
  const fill = resolveEntryFill(entry, settings);
  return {
    fill,
    accent: calendar?.color || DEFAULT_ACCENT,
    text: readableTextColor(fill, calendar?.textColor || "#ffffff"),
  };
}

/** Opacity for a chip body, dimming finished and cancelled work. */
export function entryBodyOpacity(entry: Pick<Entry, "status">): number {
  if (entry.status === "cancelled") return 0.45;
  if (entry.status === "done") return 0.62;
  return 1;
}
