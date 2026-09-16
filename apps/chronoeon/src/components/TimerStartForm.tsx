import { useEffect, useMemo, useRef, useState } from "react";
import { categoryOptionsForKind, defaultCategoryForKind, type ChronoEonSettings, type Locale, type TimerStartOptions } from "@chronoeon/domain";
import { categoryLabel, t } from "../i18n";
import { AttachmentField } from "./AttachmentField";
import { GlassSelect } from "./GlassSelect";
import { Icon } from "./Icon";
import { readCurrentPlace } from "../platform/location";

interface TimerStartFormProps {
  locale: Locale;
  settings: ChronoEonSettings;
  /** Draft category owned by the parent so it can live in a header slot. */
  category: string;
  onCategoryChange: (category: string) => void;
  /** Render the category select inside the form (mini window has no header). */
  showCategory?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  onStart: (options: TimerStartOptions) => void;
  onNotice?: (message: string, tone?: "normal" | "warning") => void;
  onTitleChange?: (title: string) => void;
}

export function timerCategoryOptions(settings: ChronoEonSettings, locale: Locale) {
  return categoryOptionsForKind("event", settings, settings.defaultCalendarID).map((option) => ({
    value: option.value,
    label: categoryLabel(option.value, locale, option.label),
    color: option.color,
  }));
}

export function defaultTimerCategory(settings: ChronoEonSettings): string {
  return defaultCategoryForKind("event", settings, settings.defaultCalendarID);
}

/** The category picker used both in the widget header and inline in the mini window. */
export function TimerCategorySelect({ locale, settings, value, onChange }: { locale: Locale; settings: ChronoEonSettings; value: string; onChange: (value: string) => void }) {
  const options = useMemo(() => timerCategoryOptions(settings, locale), [locale, settings]);
  return <GlassSelect className="timer-category" value={value} ariaLabel={t("category", locale)} options={options} onChange={onChange} />;
}

/**
 * Everything a recording can be started with. The title keeps the one-keystroke
 * promise (focused on open, Enter starts); location, note and photos are
 * optional and can also be filled in after the clock is running.
 */
export function TimerStartForm({ locale, settings, category, onCategoryChange, showCategory = false, autoFocus = true, disabled = false, onStart, onNotice, onTitleChange }: TimerStartFormProps) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [locating, setLocating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const today = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  useEffect(() => {
    if (!autoFocus) return;
    const timeout = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(timeout);
  }, [autoFocus]);

  function begin() {
    if (disabled) return;
    onStart({
      title: title.trim() || t("timerUntitled", locale),
      calendarId: settings.defaultCalendarID,
      kind: "event",
      category,
      location: location.trim() || undefined,
      note: note.trim() || undefined,
      images: images.length ? images : undefined,
    });
    setTitle("");
    onTitleChange?.("");
    setLocation("");
    setNote("");
    setImages([]);
  }

  async function locateDevice() {
    if (locating) return;
    setLocating(true);
    try {
      const place = await readCurrentPlace(locale);
      if (!place) {
        onNotice?.(t("locationUnavailable", locale), "warning");
        return;
      }
      setLocation(place.label);
    } finally {
      setLocating(false);
    }
  }

  return (
    <form className="timer-start-form" onSubmit={(event) => { event.preventDefault(); begin(); }}>
      <div className="timer-start-fields">
      {showCategory && (
        <label className="field-label"><span>{t("category", locale)}</span>
          <TimerCategorySelect locale={locale} settings={settings} value={category} onChange={onCategoryChange} />
        </label>
      )}
      <div className="timer-title-row">
        <label className="field-label field-label--large timer-title-field">
          <span>{t("title", locale)}</span>
          <input ref={inputRef} value={title} onChange={(event) => { setTitle(event.target.value); onTitleChange?.(event.target.value); }} placeholder={t("timerPlaceholder", locale)} />
        </label>
        <label className="field-label field-label--large timer-location-field">
          <span>
            {t("location", locale)}
            <button
              type="button"
              className="icon-button location-locate"
              onClick={() => void locateDevice()}
              disabled={locating}
              aria-label={t("useDeviceLocation", locale)}
              title={t("useDeviceLocation", locale)}
            >
              <Icon name="map-pin" size={14} />
            </button>
          </span>
          <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder={t("locationPlaceholder", locale)} />
        </label>
      </div>
      <label className="field-label timer-note-field"><span>{t("note", locale)}</span>
        <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("notePlaceholder", locale)} />
      </label>
      <AttachmentField locale={locale} settings={settings} entryDate={today} value={images} camera onChange={setImages} onNotice={onNotice} />
      </div>
      <button type="submit" disabled={disabled} className="primary-action timer-begin"><Icon name="play" size={15} />{t("timerStart", locale)}</button>
    </form>
  );
}
