import { useEffect, useRef, useState } from "react";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import { PRESET_COLORS, newCalendarCatalogs, readableTextColor, type CalendarConfig } from "@chronoeon/domain";
import type { Locale } from "../domain/entry";
import { calendarDisplayName, t } from "../i18n";
import { registerModalDismiss } from "./modalLayer";
import { Icon } from "./Icon";
import { ColorMenu } from "./CategoryCatalogManager";

interface CalendarCatalogManagerProps {
  locale: Locale;
  label: string;
  calendars: CalendarConfig[];
  defaultCalendarId: string;
  onChange: (calendars: CalendarConfig[]) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  onSelect?: (id: string) => void;
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
  onSelect,
}: CalendarCatalogManagerProps) {
  const [draft, setDraft] = useState<CalendarConfig | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const editing = draft;
  const isCreating = Boolean(draft && !calendars.some(calendar => calendar.id === draft.id));

  useEffect(() => {
    if (!editing) return;
    return registerModalDismiss((event) => {
      event.preventDefault();
      setDraft(null);
    });
  }, [editing]);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing?.id]);

  const patch = (id: string, change: (calendar: CalendarConfig) => CalendarConfig) => {
    setDraft((current) => current?.id === id ? change(current) : current);
  };

  function add() {
    const id = `cal-${crypto.randomUUID()}`;
    const color = PRESET_COLORS[6].hex;
    const catalogs = newCalendarCatalogs(locale, crypto.randomUUID());
    setDraft({
      id,
      name: uniqueName(calendars, locale),
      color,
      textColor: readableTextColor(color, "#ffffff"),
      folder: "Diary",
      categories: catalogs.taskCategories,
      defaultCategoryId: catalogs.taskCategories[0].id,
      billCategories: catalogs.billCategories,
      defaultBillCategoryId: catalogs.billCategories[0].id,
      defaultBillSubCategoryId: catalogs.billCategories[0].sub[0] ?? "",
      paymentMethods: catalogs.paymentMethods,
      defaultPaymentMethodId: catalogs.paymentMethods[0]?.id ?? "",
      itemCategories: catalogs.itemCategories,
      defaultItemCategoryId: catalogs.itemCategories[0]?.id ?? "",
    });
  }

  function confirmEdit() {
    if (!draft) return;
    onChange(calendars.some(calendar => calendar.id === draft.id)
      ? calendars.map(calendar => calendar.id === draft.id ? draft : calendar)
      : [...calendars, draft]);
    onSelect?.(draft.id);
    setDraft(null);
  }

  function closeEditor() {
    setDraft(null);
  }

  return (
    <section className="category-catalog" aria-label={label}>
      <header className="category-catalog-header">
        <h5>{label}</h5>
        <button type="button" className="category-add" onClick={add}>
          <Icon name="plus" size={13} />{t("addCalendar", locale)}
        </button>
      </header>
      <ul className="calendar-catalog-list">
        {calendars.map((calendar) => {
          const isDefault = calendar.id === defaultCalendarId;
          return (
            <li key={calendar.id} className={isDefault ? "calendar-catalog-row is-default" : "calendar-catalog-row"}>
              <div className="calendar-catalog-main">
                <i className="category-overview-swatch" style={{ "--swatch": calendar.color, background: calendar.color } as React.CSSProperties} aria-hidden="true" />
                <div className="category-copy">
                  <span className="category-name" title={calendarDisplayName(calendar.name, locale)}>{calendarDisplayName(calendar.name, locale)}</span>
                  {isDefault && <small className="calendar-default-badge">{t("defaultCalendarBadge", locale)}</small>}
                </div>
                <button
                  type="button"
                  className="category-edit-button"
                  onClick={() => { onSelect?.(calendar.id); setDraft(structuredClone(calendar)); }}
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
      <MotionPresence>{editing && createPortal(
        <div className="category-editor-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeEditor();
        }}>
          <section className="category-editor calendar-editor-dialog" role="dialog" aria-modal="true" aria-label={`${t("categoryEdit", locale)} · ${editing.name}`}>
            <header>
              <ColorMenu
                locale={locale}
                category={editing}
                mode="calendar"
                onColor={(color) => patch(editing.id, (current) => ({ ...current, color, textColor: readableTextColor(color, "#ffffff") }))}
              />
              <strong>{calendarDisplayName(editing.name, locale)}</strong>
              <button type="button" className="icon-button" onClick={closeEditor} aria-label={t("close", locale)}>
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
                onKeyDown={(event) => { if (event.key === "Enter") confirmEdit(); }}
              />
            </label>

            <footer>
              {isCreating ? (
                <>
                  <button type="button" className="primary-action" onClick={confirmEdit}><Icon name="check" size={14} />{t("confirmAction", locale)}</button>
                </>
              ) : <>
              <button
                type="button"
                className="danger-button"
                disabled={editing.id === defaultCalendarId}
                title={editing.id === defaultCalendarId ? t("cannotDeleteDefault", locale) : undefined}
                onClick={() => {
                  onDelete(editing.id);
                  setDraft(null);
                }}
              >
                <Icon name="trash" size={14} />{t("deleteCalendar", locale)}
              </button>
              {editing.id !== defaultCalendarId && (
                <button type="button" className="secondary-button" onClick={() => onSetDefault(editing.id)}>
                  <Icon name="check" size={14} />{t("setDefaultCalendar", locale)}
                </button>
              )}
              <button type="button" className="primary-action" onClick={confirmEdit}><Icon name="check" size={14} />{t("confirmAction", locale)}</button>
              </>}
            </footer>
          </section>
        </div>,
        document.body,
      )}</MotionPresence>
    </section>
  );
}
