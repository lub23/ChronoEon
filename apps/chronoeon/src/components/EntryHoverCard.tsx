import { resolveReminderTime, type ChronoEonSettings, type Entry, type Locale } from "../domain/entry";
import { currencySymbol, formatEntryTime, titleFor } from "../domain/entry";
import { calendarDisplayName, categoryLabel, compositeCategoryLabel, paymentMethodLabel, t, type MessageKey } from "../i18n";
import { BellGlyph, CameraGlyph, EntryGlyph, RepeatGlyph, CHIP_META_ICON_SIZE } from "./ItemGlyph";

interface EntryHoverCardProps {
  entry: Entry;
  locale: Locale;
  settings: ChronoEonSettings;
}

const recurrenceLabels: Record<string, MessageKey> = {
  daily: "recurrenceDaily",
  weekly: "recurrenceWeekly",
  monthly: "recurrenceMonthly",
  yearly: "recurrenceYearly",
};

/**
 * Passive hover preview shown over an entry row: the row itself is terse (and
 * the compact row shows no meta at all), so the popup answers "what is this?"
 * without opening the composer. Actions stay in the context menu / composer.
 */
export function EntryHoverCard({ entry, locale, settings }: EntryHoverCardProps) {
  const when = entry.allDay ? t("allDay", locale) : formatEntryTime(entry, locale);
  const calendar = settings.calendars.find((item) => item.id === (entry.calendar ?? settings.defaultCalendarID));
  const reminderAt = entry.reminder && entry.reminder !== "none"
    ? resolveReminderTime({ date: entry.date, start: entry.start, allDay: entry.allDay, reminder: entry.reminder })
    : null;

  return (
    <aside className="entry-hover-card" role="tooltip">
      <header className="entry-hover-head">
        <span className={`entry-hover-kind kind-dot kind-dot--${entry.kind}`}>
          <EntryGlyph kind={entry.kind} status={entry.status} size={15} />
        </span>
        <strong>{titleFor(entry, locale)}</strong>
      </header>

      <dl className="entry-hover-facts">
        <div><dt>{t(entry.allDay ? "allDay" : "start", locale)}</dt><dd>{when}</dd></div>
        <div><dt>{t("category", locale)}</dt><dd>{entry.category.includes("/") ? compositeCategoryLabel(entry.category, locale) : categoryLabel(entry.category, locale)}</dd></div>
        {calendar && <div><dt>{t("calendarLabel", locale)}</dt><dd>{calendarDisplayName(calendar.name, locale)}</dd></div>}
        {entry.kind === "task" && entry.status && (
          <div><dt>{t("statusLabel", locale)}</dt><dd>{t(entry.status === "done" ? "statusDone" : entry.status === "cancelled" ? "statusCancelled" : entry.status === "in-progress" ? "statusInProgress" : "statusOpen", locale)}</dd></div>
        )}
        {entry.kind === "bill" && entry.amount != null && (
          <div><dt>{t("amount", locale)}</dt><dd>{entry.amount < 0 ? "−" : entry.amount > 0 ? "+" : ""}{currencySymbol(entry.currency ?? settings.bill.currency, settings)}{Math.abs(entry.amount).toFixed(2)}</dd></div>
        )}
        {entry.payment && <div><dt>{t("payment", locale)}</dt><dd>{paymentMethodLabel(entry.payment, locale)}</dd></div>}
        {entry.priority && <div><dt>{t("priority", locale)}</dt><dd>{t(entry.priority === "high" ? "priorityHigh" : "priorityLow", locale)}</dd></div>}
        {entry.urgency && <div><dt>{t("urgency", locale)}</dt><dd>{t(entry.urgency === "high" ? "priorityHigh" : "priorityLow", locale)}</dd></div>}
        {entry.location && <div><dt>{t("location", locale)}</dt><dd>{entry.location}</dd></div>}
      </dl>

      {(entry.recurrence || reminderAt || entry.tags?.length || entry.images?.length) && (
        <p className="entry-hover-badges">
          {entry.recurrence && entry.recurrence !== "none" && (
            <span className="entry-hover-badge"><RepeatGlyph size={CHIP_META_ICON_SIZE} />{t(recurrenceLabels[entry.recurrence] ?? "recurrence", locale)}</span>
          )}
          {reminderAt && (
            <span className="entry-hover-badge"><BellGlyph size={CHIP_META_ICON_SIZE} />{t("reminderNext", locale)} {reminderAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          )}
          {entry.tags?.length ? <span className="entry-hover-badge">{entry.tags.map((tag) => `#${tag}`).join(" ")}</span> : null}
          {entry.images?.length ? <span className="entry-hover-badge"><CameraGlyph size={CHIP_META_ICON_SIZE} />{entry.images.length} {t("attachmentsCount", locale)}</span> : null}
        </p>
      )}

      {entry.note && <p className="entry-hover-note">{entry.note}</p>}
    </aside>
  );
}
