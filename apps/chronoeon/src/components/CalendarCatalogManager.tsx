import { useEffect, useRef, useState } from "react";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import { PRESET_COLORS, defaultTaskCategories, readableTextColor, type CalendarConfig } from "@chronoeon/domain";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { registerModalDismiss } from "./modalLayer";
import { Icon } from "./Icon";

interface CalendarCatalogManagerProps {
  locale: Locale;
  label: string;
  calendars: CalendarConfig[];
  defaultCalendarId: string;
  onChange: (calendars: CalendarConfig[]) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}

function uniqueName(calendars: CalendarConfig[], locale: Locale): string {
  const base = locale === "zh" ? "新日历" : "New calendar";
  let name = base;
  let index = 2;
  while (calendars.some((calendar) => calendar.name === name)) name = `${base} ${index++}`;
  return name;
}

export function CalendarCatalogManager({
  locale,
  label,
  calendars,
  defaultCalendarId,
  onChange,
  onDelete,
  onSetDefault,
}: CalendarCatalogManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const editing = calendars.find((calendar) => calendar.id === editingId) ?? null;

  useEffect(() => {
    if (!editing) return;
    return registerModalDismiss((event) => {
      event.preventDefault();
      setEditingId(null);
    });
  }, [editing]);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing?.id]);

  const patch = (id: string, change: (calendar: CalendarConfig) => CalendarConfig) => {
    onChange(calendars.map((calendar) => calendar.id === id ? change(calendar) : calendar));
  };

  function add() {
    const id = `cal-${crypto.randomUUID()}`;
    const color = PRESET_COLORS[6].hex;
    // A second calendar owns its own category ids so the shared filter can
    // never merge two calendars' "Default" chips into one value.
    const categories = defaultTaskCategories(locale).map((category) => ({ ...category, id: `catalog-${crypto.randomUUID()}` }));
    onChange([...calendars, {
      id,
      name: uniqueName(calendars, locale),
      color,
      textColor: readableTextColor(color, "#ffffff"),
      folder: "Diary",
      categories,
      defaultCategoryId: categories[0].id,
    }]);
    setEditingId(id);
  }

  return (
    <section className="category-catalog" aria-label={label}>
      <ul className="calendar-catalog-list">
        {calendars.map((calendar) => {
          const isDefault = calendar.id === defaultCalendarId;
          return (
            <li key={calendar.id} className="calendar-catalog-row">
              <div className="calendar-catalog-main">
                <i className="category-overview-swatch" style={{ "--swatch": calendar.color, background: calendar.color } as React.CSSProperties} aria-hidden="true" />
                <div className="category-copy">
                  <span className="category-name" title={calendar.name}>{calendar.name}</span>
                  {isDefault && <small className="calendar-default-badge">{t("defaultCalendarBadge", locale)}</small>}
                </div>
                <button
                  type="button"
                  className="category-edit-button"
                  onClick={() => setEditingId(calendar.id)}
                  aria-label={`${t("categoryEdit", locale)} · ${calendar.name}`}
                  title={t("categoryEdit", locale)}
                >
                  <Icon name="edit" size={13} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <button type="button" className="category-add" onClick={add}>
        <Icon name="plus" size={13} />{t("addCalendar", locale)}
      </button>

      <MotionPresence>{editing && createPortal(
        <div className="category-editor-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setEditingId(null);
        }}>
          <section className="category-editor calendar-editor-dialog" role="dialog" aria-modal="true" aria-label={`${t("categoryEdit", locale)} · ${editing.name}`}>
            <header>
              <i className="category-overview-swatch" style={{ "--swatch": editing.color, background: editing.color } as React.CSSProperties} aria-hidden="true" />
              <strong>{editing.name}</strong>
              <button type="button" className="icon-button" onClick={() => setEditingId(null)} aria-label={t("close", locale)}>
                <Icon name="close" size={15} />
              </button>
            </header>

            <label className="field-label">
              <span>{t("calendarName", locale)}</span>
              <input
                ref={nameInputRef}
                className="category-name-input"
                value={editing.name}
                aria-label={t("calendarName", locale)}
                onChange={(event) => patch(editing.id, (current) => ({ ...current, name: event.target.value }))}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (!value) patch(editing.id, (current) => ({ ...current, name: t("categoryUntitled", locale) }));
                }}
                onKeyDown={(event) => { if (event.key === "Enter") setEditingId(null); }}
              />
            </label>

            <div className="calendar-color-row">
              <span>{t("categoryColorCustom", locale)}</span>
              <div className="calendar-preset-grid">
                {PRESET_COLORS.map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    className={editing.color.toLowerCase() === preset.hex.toLowerCase() ? "preset-color is-active" : "preset-color"}
                    style={{ background: preset.hex }}
                    onClick={() => patch(editing.id, (current) => ({ ...current, color: preset.hex, textColor: readableTextColor(preset.hex, "#ffffff") }))}
                    aria-label={`${locale === "zh" ? preset.nameZh : preset.nameEn} ${preset.hex}`}
                    title={`${locale === "zh" ? preset.nameZh : preset.nameEn} ${preset.hex}`}
                  />
                ))}
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(editing.color) ? editing.color : "#77787b"}
                  onChange={(event) => patch(editing.id, (current) => ({
                    ...current,
                    color: event.target.value,
                    textColor: readableTextColor(event.target.value, "#ffffff"),
                  }))}
                  aria-label={t("categoryColorCustom", locale)}
                />
              </div>
            </div>

            <footer>
              <button
                type="button"
                className="danger-button"
                disabled={editing.id === defaultCalendarId}
                title={editing.id === defaultCalendarId ? t("cannotDeleteDefault", locale) : undefined}
                onClick={() => {
                  onDelete(editing.id);
                  setEditingId(null);
                }}
              >
                <Icon name="trash" size={14} />{t("deleteCalendar", locale)}
              </button>
              {editing.id !== defaultCalendarId && (
                <button type="button" className="secondary-button" onClick={() => onSetDefault(editing.id)}>
                  <Icon name="check" size={14} />{t("setDefaultCalendar", locale)}
                </button>
              )}
              <button type="button" className="primary-action" onClick={() => setEditingId(null)}>{t("close", locale)}</button>
            </footer>
          </section>
        </div>,
        document.body,
      )}</MotionPresence>
    </section>
  );
}
