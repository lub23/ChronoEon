import { useEffect, useRef, useState, type CSSProperties } from "react";
import { billDirectionForCategory, resolveEntryColors, type ChronoEonSettings } from "@chronoeon/domain";
import type { Entry, Locale } from "../domain/entry";
import { currencySymbol, formatEntryTime, titleFor } from "../domain/entry";
import { categoryLabel, compositeCategoryLabel, paymentMethodLabel, t } from "../i18n";
import { EntryHoverCard } from "./EntryHoverCard";
import { Icon } from "./Icon";
import { CHIP_ICON_SIZE, CHIP_META_ICON_SIZE, CameraGlyph, EntryGlyph, BellGlyph, RepeatGlyph } from "./ItemGlyph";

interface EntryRowProps {
  entry: Entry;
  locale: Locale;
  settings: ChronoEonSettings;
  compact?: boolean;
  onToggle: (id: string, entry?: Entry) => void;
  onEdit: (entry: Entry) => void;
  onMenu?: (entry: Entry, event: React.MouseEvent) => void;
}

export function EntryRow({ entry, locale, settings, compact = false, onToggle, onEdit, onMenu }: EntryRowProps) {
  const isDone = entry.status === "done";
  const isCancelled = entry.status === "cancelled";
  const time = entry.start ?? (entry.allDay ? t("allDay", locale) : t("anytime", locale));
  const detail = formatEntryTime(entry, locale);
  const { fill, accent } = resolveEntryColors(entry, settings);
  const openMenu = onMenu ? (event: React.MouseEvent) => { event.preventDefault(); onMenu(entry, event); } : undefined;
  const isTask = entry.kind === "task";
  const billDirection = entry.kind === "bill" ? billDirectionForCategory(entry.category, settings) : "expense";

  // Hover intent delay keeps a fast pointer sweep from flashing the preview.
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  useEffect(() => () => { if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current); }, []);
  const beginHover = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(true), 350);
  };
  const endHover = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHovered(false);
  };

  return (
    <article
      className={`entry-row entry-row--${entry.kind}${isDone ? " is-done" : ""}${isCancelled ? " is-cancelled" : ""}${compact ? " entry-row--compact" : ""}`}
      style={{ "--entry-color": fill, "--entry-accent": accent } as CSSProperties}
      onContextMenu={openMenu}
      onMouseEnter={beginHover}
      onMouseLeave={endHover}
      onMouseDown={endHover}
    >
      <div className="entry-time">{entry.start ? entry.start : <span>{time}</span>}</div>
      <span className="entry-line-dot" />
      {isTask ? (
        <button
          className="task-check"
          type="button"
          onClick={() => onToggle(entry.id, entry)}
          title={t(isDone ? "markOpen" : "markDone", locale)}
          aria-label={t(isDone ? "markOpen" : "markDone", locale)}
          aria-pressed={isDone}
        >
          <EntryGlyph kind="task" status={entry.status} size={CHIP_ICON_SIZE} />
        </button>
      ) : (
        <span className="entry-kind-icon"><EntryGlyph kind={entry.kind} size={CHIP_ICON_SIZE} /></span>
      )}
      <button className="entry-main" type="button" onClick={() => onEdit(entry)}>
        <span className="entry-title">
          {titleFor(entry, locale)}
          {entry.recurrenceSourceId && <i className="entry-badge" title={t("recurrence", locale)}><RepeatGlyph size={CHIP_META_ICON_SIZE} /></i>}
          {entry.reminder && entry.reminder !== "none" && <i className="entry-badge" title={t("reminder", locale)}><BellGlyph size={CHIP_META_ICON_SIZE} /></i>}
          {entry.images?.length ? <i className="entry-badge" title={`${entry.images.length} ${t("attachmentsCount", locale)}`}><CameraGlyph size={CHIP_META_ICON_SIZE} /></i> : null}
        </span>
        {!compact && (
          <span className="entry-meta">
            <span>{detail}</span>
            <span className="meta-separator">·</span>
            <span>{entry.category.includes("/") ? compositeCategoryLabel(entry.category, locale) : categoryLabel(entry.category, locale)}</span>
            {entry.payment && <><span className="meta-separator">·</span><span>{paymentMethodLabel(entry.payment, locale)}</span></>}
            {entry.location && <><span className="meta-separator">·</span><Icon name="map-pin" size={12} /><span>{entry.location}</span></>}
            {entry.tags?.length ? <><span className="meta-separator">·</span><span className="entry-tags">{entry.tags.map((tag) => `#${tag}`).join(" ")}</span></> : null}
          </span>
        )}
      </button>
      {entry.kind === "bill" && entry.amount != null && (
        <strong
          className={`entry-amount is-${billDirection}`}
          title={t(billDirection === "income" ? "billIncome" : "statsExpense", locale)}
        >
          {currencySymbol(entry.currency ?? settings.bill.currency, settings)}
          {billDirection === "income" ? "" : "-"}{Math.abs(entry.amount).toFixed(2)}
        </strong>
      )}
      {!compact && (
        <button
          className="entry-more"
          type="button"
          onClick={(event) => (onMenu ? onMenu(entry, event) : onEdit(entry))}
          aria-label={t("entryActions", locale)}
          aria-haspopup="menu"
          title={t("entryActions", locale)}
        >
          <Icon name="more" size={17} />
        </button>
      )}
      {hovered && <EntryHoverCard entry={entry} locale={locale} settings={settings} />}
    </article>
  );
}
