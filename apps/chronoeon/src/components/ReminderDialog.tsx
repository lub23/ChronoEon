import { useEffect } from "react";
import { format, parseISO } from "date-fns";
import type { DueReminder, Entry, Locale } from "@chronoeon/domain";
import { formatEntryTime } from "@chronoeon/domain";
import { categoryLabel, compositeCategoryLabel, t } from "../i18n";
import { useModalDismiss } from "./modalLayer";
import { Icon } from "./Icon";

interface ReminderDialogProps {
  reminders: DueReminder[];
  locale: Locale;
  onClose: () => void;
  onOpen: (entry: Entry) => void;
}

export function ReminderDialog({ reminders, locale, onClose, onOpen }: ReminderDialogProps) {
  useModalDismiss((event) => {
    event.preventDefault();
    onClose();
  });

  return (
    <div className="confirm-backdrop reminder-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="reminder-sheet" role="alertdialog" aria-modal="true" aria-labelledby="reminder-title">
        <header>
          <span className="reminder-mark"><Icon name="bell" size={20} /></span>
          <div>
            <span>{t("remindersAggregated", locale)}</span>
            <h2 id="reminder-title">{t("reminderTitle", locale)}</h2>
            {reminders.length > 1 && <p>{reminders.length} {t("remindersDue", locale)}</p>}
          </div>
        </header>

        <ul>
          {reminders.map((reminder) => {
            const entry = reminder.entry;
            const date = parseISO(entry.occurrenceDate ?? entry.date);
            const when = entry.allDay ? t("allDay", locale) : formatEntryTime(entry, locale);
            const category = entry.kind === "bill"
              ? compositeCategoryLabel(entry.category, locale)
              : categoryLabel(entry.category, locale, entry.category);
            const details = [entry.location, entry.note?.replace(/\s+/g, " ").trim().slice(0, 120)].filter(Boolean);
            return (
              <li key={reminder.key}>
                <i style={{ background: entry.color || "var(--accent)" }} aria-hidden="true" />
                <div>
                  <strong>{entry.title || t("reminderTitle", locale)}</strong>
                  <small>{format(date, locale === "zh" ? "M月d日" : "MMM d")}{when ? ` · ${when}` : ""}</small>
                  {(category || details.length > 0) && (
                    <small className="reminder-details">
                      {[category, ...details].filter(Boolean).join(" · ")}
                    </small>
                  )}
                </div>
                <button type="button" onClick={() => onOpen(entry)}>
                  <Icon name="edit" size={13} />{t("reminderOpen", locale)}
                </button>
              </li>
            );
          })}
        </ul>

        <footer>
          <button type="button" className="primary-action" autoFocus onClick={onClose}>
            <Icon name="check" size={15} />{t("reminderDone", locale)}
          </button>
        </footer>
      </section>
    </div>
  );
}
