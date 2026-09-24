import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { weekdayLabels, weekdayTitles } from "./entryFieldLabels";

interface RecurrenceWeekdaysProps {
  locale: Locale;
  /** Selected weekdays, 0 = Sunday. */
  value: number[] | undefined;
  onToggle: (day: number, selected: boolean) => void;
}

/** Which weekdays a weekly series repeats on; shared by both composers. */
export function RecurrenceWeekdays({ locale, value, onToggle }: RecurrenceWeekdaysProps) {
  const titles = weekdayTitles(locale);
  return (
    <fieldset className="weekday-field">
      <legend>{t("repeatOn", locale)}</legend>
      <div className="weekday-picker">
        {weekdayLabels.map((day, index) => (
          <label key={index} title={titles[index]} className={value?.includes(index) ? "weekday-option is-active" : "weekday-option"}>
            <input type="checkbox" checked={Boolean(value?.includes(index))} onChange={(event) => onToggle(index, event.target.checked)} />
            <span>{day}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
