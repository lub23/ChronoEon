import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  billDirectionForCategory,
  entryBodyOpacity,
  formatBillLabel,
  formatCalendarItemTimeRange,
  formatEntryTime,
  hexToRgba,
  resolveEntryColors,
  type ChronoEonSettings,
} from "@chronoeon/domain";
import type { Entry, EntryStatus, Locale } from "../domain/entry";
import { currencySymbol, titleFor } from "../domain/entry";
import { t } from "../i18n";
import { FadeText } from "./FadeText";
import { CHIP_ICON_SIZE, CHIP_META_ICON_SIZE, CameraGlyph, CurrencyGlyph, EntryGlyph, LocationGlyph, RepeatGlyph, BellGlyph } from "./ItemGlyph";

/**
 * `month` and `all-day` are single-line chips of the same fixed height;
 * `timed` fills a time-grid block; `list` is the three-line agenda card.
 * Every variant draws the SAME glyph at the SAME size in the same slot.
 */
export type ChipVariant = "month" | "all-day" | "timed" | "list";

export interface ItemChipProps {
  entry: Entry;
  settings: ChronoEonSettings;
  locale: Locale;
  variant: ChipVariant;
  style?: CSSProperties;
  className?: string;
  dragging?: boolean;
  /**
   * The origin slot of a move that is in flight: rendered as an empty, dashed
   * outline so the user always sees where the item came from while the ghost
   * previews where it will land. Non-interactive.
   */
  dragSource?: boolean;
  /**
   * The snapped landing position of a move that is in flight: rendered as a
   * light, low-opacity item at the target so the user sees exactly what the
   * drop will look like. Non-interactive.
   */
  ghost?: boolean;
  /** True when the visible segment starts on an earlier day. */
  continuesBefore?: boolean;
  /** True when the visible segment ends on a later day. */
  continuesAfter?: boolean;
  /** Phone-width month cells drop the HH:MM prefix and rely on the peek/list for exact times. */
  compactLabel?: boolean;
  /** Number of one-line details a timed chip can show (title + time/note/location). */
  detailLines?: 1 | 2 | 3 | 4;
  /** The rendered segment lies before the current moment; unfinished tasks opt out. */
  past?: boolean;
  onOpen?: (entry: Entry) => void;
  onStatusToggle?: (entry: Entry) => void;
  onMenu?: (entry: Entry, event: ReactMouseEvent) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  children?: React.ReactNode;
}

function billAmountLabel(entry: Entry, settings: ChronoEonSettings): string {
  if (entry.kind !== "bill" || typeof entry.amount !== "number") return "";
  // Direction is the explicit cash-flow fact, so the amount mirrors it.
  const direction = billDirectionForCategory(entry.category, settings);
  const signed = direction === "income" ? Math.abs(entry.amount) : -Math.abs(entry.amount);
  return formatBillLabel(signed, "");
}

/** `HH:MM` prefix for a timed chip; all-day and bill chips show none. */
function timePrefix(entry: Entry): string {
  if (entry.allDay || !entry.start) return "";
  return entry.start;
}

function timeRangeLabel(entry: Entry, locale: Locale): string {
  // With a real clock time, reuse the shared list-style range (it adds the
  // `(+1)` day marker and a duration); otherwise fall back to the plain
  // "All day"/"Anytime" wording the rest of the app already uses.
  if (!entry.allDay && entry.start) {
    return formatCalendarItemTimeRange({
      allDay: false,
      modality: entry.kind,
      begin: `${entry.date} ${entry.start}`,
      end: entry.end ? `${entry.endDate ?? entry.date} ${entry.end}` : undefined,
    }, locale);
  }
  return formatEntryTime(entry, locale);
}



export function ItemChip({
  entry,
  settings,
  locale,
  variant,
  style,
  className,
  dragging = false,
  dragSource = false,
  ghost = false,
  continuesBefore = false,
  continuesAfter = false,
  compactLabel = false,
  detailLines,
  past = false,
  onOpen,
  onStatusToggle,
  onMenu,
  onPointerDown,
  children,
}: ItemChipProps) {
  // A drag source or ghost is a non-interactive preview, not a live control.
  // Strip the button affordances so the preview can never be opened, toggled
  // or re-dragged while the real gesture is in flight.
  const preview = dragSource || ghost;
  const { fill, accent, text } = resolveEntryColors(entry, settings);
  const unfinishedTask = entry.kind === "task" && (entry.status === "open" || entry.status === "in-progress" || !entry.status);
  const bodyOpacity = past && !unfinishedTask
    ? Math.min(entryBodyOpacity(entry), 0.62)
    : entryBodyOpacity(entry);
  const isTask = entry.kind === "task";
  const isBill = entry.kind === "bill";
  const billLabel = billAmountLabel(entry, settings);
  const billDirection = isBill ? billDirectionForCategory(entry.category, settings) : "expense";
  const title = titleFor(entry, locale);

  // All-day chips sit over the day's photo backdrop, so only their FILL becomes
  // translucent — dimming the whole chip with `opacity` would take the label
  // with it and make short titles unreadable against a bright photo.
  //
  // List rows are the one full-width, multi-line surface, and painting the
  // entry colour across it at full strength was measurably unreadable: an
  // uncategorised item (#8b8b83) gave 4.28:1 against its own auto-picked label
  // colour, under the 4.5:1 AA floor for the 10px meta and note lines, and no
  // choice of label colour can rescue a mid-luminance fill on that much area.
  // A soft wash instead lets the row inherit `--ink` (high contrast on the
  // panel) while the entry's colour still identifies it through the left accent
  // rail and the glyph — the same calm-glass idiom every other surface uses.
  const background = variant === "all-day" ? hexToRgba(fill, 0.58)
    : variant === "list" ? hexToRgba(fill, 0.16)
    : variant === "timed" ? hexToRgba(fill, 0.34)
    : variant === "month" ? hexToRgba(fill, 0.58)
    : fill;
  const showRepeat = Boolean(entry.recurrence && entry.recurrence !== "none") || Boolean(entry.recurrenceSourceId);
  const showBell = Boolean(entry.reminder && entry.reminder !== "none");
  const hasPhotos = Boolean(entry.images?.length);

  const hoverTitle = [
    title,
    timeRangeLabel(entry, locale),
    billLabel,
    entry.location,
  ].filter(Boolean).join("\n");

  const chipStyle: CSSProperties = {
    "--chip-fill": fill,
    "--chip-accent": accent,
    "--chip-text": text,
    background,
    // A washed list row keeps the panel's ink; every other variant is a solid
    // fill that needs its WCAG-picked label colour.
    color: variant === "list" || variant === "timed" || variant === "month" || variant === "all-day" ? undefined : text,
    borderLeftColor: hexToRgba(accent, ghost ? 0.74 : dragging ? 0.5 : 1),
    // The origin slot is an empty dashed outline (its fill is removed below);
    // the target ghost is a light, low-opacity item so it reads as "will land
    // here" without competing with the real chips around it.
    opacity: dragging ? 0.42 : ghost ? 0.68 : bodyOpacity,
    ...style,
  } as CSSProperties;
  if (dragSource) {
    chipStyle.background = "transparent";
    chipStyle.color = "transparent";
    chipStyle.borderLeftColor = hexToRgba(accent, 0.55);
  }

  const classes = [
    "item-chip",
    `item-chip--${variant}`,
    `item-chip--${entry.kind}`,
    entry.status === "done" ? "is-done" : "",
    entry.status === "cancelled" ? "is-cancelled" : "",
    past ? "is-past" : "",
    dragging ? "is-dragging" : "",
    dragSource ? "is-drag-source" : "",
    ghost ? "is-drag-ghost" : "",
    continuesBefore ? "continues-before" : "",
    continuesAfter ? "continues-after" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  const glyph = (
    <span
      className={isTask && onStatusToggle ? "item-chip-glyph is-interactive" : "item-chip-glyph"}
      role={isTask && onStatusToggle ? "button" : undefined}
      tabIndex={isTask && onStatusToggle ? 0 : undefined}
      aria-label={isTask && onStatusToggle ? t(entry.status === "done" ? "markOpen" : "markDone", locale) : undefined}
      title={isTask && onStatusToggle ? t(entry.status === "done" ? "markOpen" : "markDone", locale) : undefined}
      onPointerDown={isTask && onStatusToggle ? (event) => event.stopPropagation() : undefined}
      onClick={isTask && onStatusToggle ? (event) => { event.stopPropagation(); onStatusToggle(entry); } : undefined}
      onKeyDown={isTask && onStatusToggle ? (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onStatusToggle(entry); }
      } : undefined}
    >
      {isBill && typeof entry.amount === "number"
        ? <CurrencyGlyph code={entry.currency ?? settings.bill.currency} size={CHIP_ICON_SIZE} />
        : <EntryGlyph kind={entry.kind} status={entry.status} size={CHIP_ICON_SIZE} />}
    </span>
  );

  const badges = (
    <span className="item-chip-badges">
      {showRepeat && <i title={t("recurrence", locale)}><RepeatGlyph size={CHIP_META_ICON_SIZE} /></i>}
      {showBell && <i title={t("reminder", locale)}><BellGlyph size={CHIP_META_ICON_SIZE} /></i>}
      {hasPhotos && <i title={`${entry.images?.length} ${t("attachmentsCount", locale)}`}><CameraGlyph size={CHIP_META_ICON_SIZE} /></i>}
    </span>
  );

  const shared = preview
    ? {
        className: classes,
        style: { ...chipStyle, pointerEvents: "none" as const },
        "aria-hidden": true as const,
      }
    : {
        className: classes,
        style: chipStyle,
        title: hoverTitle,
        onPointerDown,
        onContextMenu: onMenu ? (event: ReactMouseEvent) => { event.preventDefault(); event.stopPropagation(); onMenu(entry, event); } : undefined,
        onClick: onOpen ? (event: ReactMouseEvent) => { event.stopPropagation(); onOpen(entry); } : undefined,
        onKeyDown: onOpen ? (event: React.KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(entry); }
        } : undefined,
        tabIndex: 0,
        role: "button" as const,
        "aria-label": `${title} · ${timeRangeLabel(entry, locale)}`,
      };

  if (variant === "list") {
    return (
      <article {...shared}>
        <span className="item-chip-line item-chip-line--meta">
          <FadeText className="item-chip-time">{timeRangeLabel(entry, locale)}</FadeText>
          {entry.location && (
            <span className="item-chip-location" title={entry.location}>
              <LocationGlyph size={CHIP_META_ICON_SIZE} /><FadeText className="item-chip-location-text">{entry.location}</FadeText>
            </span>
          )}
        </span>
        <span className="item-chip-line item-chip-line--main">
          {glyph}
          {isBill && billLabel && (
            <b className={`item-chip-amount is-${billDirection}`}>
              <i className="item-chip-flow">{t(billDirection === "income" ? "billIncome" : "statsExpense", locale)}</i>
              {billLabel}
            </b>
          )}
        <FadeText className="item-chip-title">{title}</FadeText>
          {badges}
        </span>
        {(entry.note || entry.tags?.length) && (
          <span className="item-chip-line item-chip-line--note">
            {entry.tags?.length ? <span className="item-chip-tags">{entry.tags.map((tag) => `#${tag}`).join(" ")}</span> : null}
            {entry.note && <FadeText className="item-chip-note">{entry.note}</FadeText>}
          </span>
        )}
        {children}
      </article>
    );
  }

  if (variant === "timed") {
    const visibleLines = detailLines ?? (compactLabel ? 1 : 2);
    return (
      <article {...shared}>
        <span className="item-chip-timed-body">
          <span className="item-chip-line item-chip-line--main">
            {glyph}
        <FadeText className="item-chip-title">{title}</FadeText>
            {badges}
          </span>
          {visibleLines >= 2 && (
            <FadeText className="item-chip-time">{isBill && billLabel ? `${t(billDirection === "income" ? "billIncome" : "statsExpense", locale)} · ${billLabel}` : timeRangeLabel(entry, locale)}</FadeText>
          )}
          {visibleLines >= 3 && entry.note && (
            <FadeText className="item-chip-note">{entry.note}</FadeText>
          )}
          {visibleLines >= 4 && entry.location && (
            <span className="item-chip-location" title={entry.location}>
              <LocationGlyph size={CHIP_META_ICON_SIZE} /><FadeText className="item-chip-location-text">{entry.location}</FadeText>
            </span>
          )}
        </span>
        {children}
      </article>
    );
  }

  // month / all-day — one fixed-height line: glyph, optional time or amount, title.
  return (
    <article {...shared}>
      {glyph}
      {isBill && billLabel && (
        <b className={`item-chip-amount is-${billDirection}`}>
          <i className="item-chip-flow">{t(billDirection === "income" ? "billIncome" : "statsExpense", locale)}</i>
          {billLabel}
        </b>
      )}
      <FadeText className="item-chip-title">{!isBill && !compactLabel && timePrefix(entry) ? `${timePrefix(entry)} ` : ""}{title}</FadeText>
      {badges}
      {children}
    </article>
  );
}
