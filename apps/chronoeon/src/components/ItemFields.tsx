import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { BUILTIN_CURRENCIES, billDirectionForCategory, defaultPaymentMethodForCalendar, paymentMethodsForCalendar, type Item, type ItemDraft, type ChronoEonSettings, type Entry, type Locale } from "@chronoeon/domain";
import { t, paymentMethodLabel } from "../i18n";
import { GlassDatePicker, GlassTimePicker } from "./GlassDateTimePicker";
import { pickEntryAttachments, releaseAttachment } from "../platform/attachments";
import { readCurrentPlace } from "../platform/location";
import { disposalLabels as itemDisposalLabels, itemCategoryIconName, itemCategoryLabel, itemMoney } from "./ItemsView";
import { GlassSelect } from "./GlassSelect";
import { Icon } from "./Icon";
import { AttachmentThumb } from "./AttachmentThumb";
import { openImagePreview } from "./photoPreviewBus";
import { clearChipDrag, markChipDragActive } from "./dragGesture";
import { FieldSuggestions } from "./FieldSuggestions";

export interface ItemFieldsProps {
  locationSuggestions?: Array<{ value: string }>;
  draft: ItemDraft;
  patch: (value: Partial<ItemDraft>) => void;
  items: Item[];
  entries: Entry[];
  locale: Locale;
  settings: ChronoEonSettings;
  today: string;
  busy?: boolean;
  editing?: boolean;
  itemId?: string;
  onOpenBill?: (entry: Entry) => void;
  showDate?: boolean;
  showPhotos?: boolean;
  onError?: (message: string) => void;
}

function BillPicker({ value, direction, itemId, items, entries, settings, locale, name, onChange, disabled, onOpenBill }: {
  onOpenBill?: (entry: Entry) => void;
  value?: string; direction: "income" | "expense"; itemId?: string; items: Item[]; entries: Entry[];
  settings: ChronoEonSettings; locale: Locale; name: string; onChange: (entry?: Entry) => void; disabled?: boolean;
}) {
  const eligible = useMemo(() => {
    const taken = new Set(items.filter(item => item.id !== itemId).flatMap(item => [item.purchaseEntryId, item.saleEntryId]).filter(Boolean));
    return entries.filter(entry => entry.kind === "bill" && !taken.has(entry.id) && billDirectionForCategory(entry.category, settings, entry.calendar) === direction)
      .sort((left, right) => right.date.localeCompare(left.date));
  }, [items, itemId, direction, entries, settings]);
  const query = name.trim().toLocaleLowerCase();
  const matches = query
    ? eligible.filter(entry => `${entry.date} ${entry.title} ${entry.note ?? ""}`.toLocaleLowerCase().includes(query))
    : eligible;
  const selected = entries.find(entry => entry.kind === "bill" && entry.id === value);
  const visible = selected && !matches.includes(selected) ? [selected, ...matches.slice(0, 79)] : matches.slice(0, 80);
  const label = t("itemBillLink", locale);
  return (
    <label className="field-label item-bill-picker">
      <span className="linked-field-heading">{label}{selected && onOpenBill && <button type="button" className="icon-button" aria-label={`${label} · ${selected.title}`} onClick={() => onOpenBill(selected)}><Icon name="arrow-right" size={14} /></button>}</span>
      <GlassSelect
        value={value ?? ""}
        disabled={disabled}
        ariaLabel={label}
        options={[
          { value: "", label: t("itemNoBill", locale) },
          ...(value && !selected ? [{ value, label: t("itemBillMissing", locale) }] : []),
          ...visible.map(entry => ({
            value: entry.id,
            label: `${entry.date} · ${entry.title}`,
            description: [
              itemMoney(Math.abs(entry.amount ?? 0), entry.currency ?? settings.bill.currency, settings, locale),
              entry.note,
            ].filter(Boolean).join(" · "),
          })),
        ]}
        onChange={id => onChange(eligible.find(entry => entry.id === id))}
      />
    </label>
  );
}

export function ItemPhotoField({ value, icon, locale, settings, entryDate, busy, disabled, onChange, onNotice }: {
  value: string[]; locale: Locale; settings: ChronoEonSettings; entryDate: string; busy?: boolean; disabled?: boolean;
  icon?: ReactNode;
  onChange: (images: string[]) => void; onNotice?: (message: string) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const suppressPreviewUntil = useRef(0);
  useEffect(() => () => { window.clearTimeout(timerRef.current); if (dragRef.current !== null) clearChipDrag(); }, []);

  function clearDrag() {
    if (dragRef.current !== null) suppressPreviewUntil.current = Date.now() + 400;
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    dragRef.current = null;
    setDragIndex(null);
    clearChipDrag();
  }

  function pointerDown(index: number, event: PointerEvent<HTMLLIElement>) {
    if (disabled || busy || value.length < 2) return;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    timerRef.current = window.setTimeout(() => {
      target.setPointerCapture(pointerId);
      dragRef.current = index;
      setDragIndex(index);
      markChipDragActive();
    }, 320);
  }

  function pointerMove(event: PointerEvent<HTMLLIElement>) {
    const from = dragRef.current;
    if (from === null) return;
    const target = document.elementsFromPoint(event.clientX, event.clientY)
      .find(element => element instanceof HTMLElement && element.dataset.photoIndex !== undefined);
    const to = target instanceof HTMLElement ? Number(target.dataset.photoIndex) : Number.NaN;
    if (!Number.isInteger(to) || to === from || to < 0 || to >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    dragRef.current = to;
    setDragIndex(to);
    onChange(next);
  }

  function remove(reference: string) {
    releaseAttachment(reference);
    onChange(value.filter(image => image !== reference));
  }

  return (
    <section className="item-photo-field item-field-wide" aria-label={t("itemCover", locale)}>
      <div className="item-photo-head">
        {value.length === 0 && <span className="item-photo-default" aria-hidden="true">{icon ?? <Icon name="box" size={20} />}</span>}
        <div className="item-photo-copy">
          <span className="field-label-text">{t("itemCover", locale)}{value.length > 0 && <small> · {value.length}</small>}</span>
          <p className="field-hint">{t("itemCoverHint", locale)}</p>
        </div>
      </div>
      {value.length > 0 && (
        <ul className="item-photo-grid">
          {value.map((reference, index) => (
            <li key={reference} data-photo-index={index} className={dragIndex === index ? "is-dragging" : ""}
              onPointerDown={event => pointerDown(index, event)} onPointerMove={pointerMove}
              onPointerUp={clearDrag} onPointerCancel={clearDrag} onLostPointerCapture={clearDrag}>
              <button type="button" className="item-photo-preview" aria-label={t("photoPreview", locale)} onClick={() => { if (Date.now() >= suppressPreviewUntil.current) openImagePreview(value, index); }}><AttachmentThumb locale={locale} reference={reference} /></button>
              {index === 0 && <span className="item-photo-cover">{t("itemCover", locale)}</span>}
              <button type="button" className="item-photo-remove" disabled={disabled || busy} onPointerDown={event => event.stopPropagation()} onClick={() => remove(reference)} aria-label={`${t("itemCoverRemove", locale)} · ${reference}`}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="item-photo-actions">
        <button type="button" className="secondary-button" disabled={disabled || busy} onClick={async () => {
          try {
            const { picked, skipped } = await pickEntryAttachments({ settings, entryDate });
            if (skipped.length) onNotice?.(skipped.join(", "));
            if (picked.length) onChange([...value, ...picked.map(photo => photo.reference)]);
          } catch { onNotice?.(t("attachmentSaveFailed", locale)); }
        }}>
          <Icon name="image" size={14} />{busy ? t("importExportBusy", locale) : t("itemCoverPick", locale)}
        </button>
      </div>
    </section>
  );
}

export function ItemFields({
  draft, patch, items, entries, locale, settings, today, busy = false, locationSuggestions = [],
  editing = false, itemId, onOpenBill, showDate = true, showPhotos = true, onError,
}: ItemFieldsProps) {
  const [locating, setLocating] = useState(false);
  const locationInput = useRef<HTMLInputElement | null>(null);
  const acquiredTime = draft.acquiredAt.match(/(\d{2}:\d{2})$/)?.[1] ?? "12:00";
  function linkBill(entry: Entry | undefined, sale = false) {
    if (sale) patch({ saleEntryId: entry?.id, ...(entry ? { disposedOn: entry.date, saleAmount: Math.abs(entry.amount ?? 0) } : {}) });
    else patch({
      purchaseEntryId: entry?.id,
      ...(entry ? {
        calendarId: entry.calendar ?? draft.calendarId,
        name: draft.name.trim() || entry.title,
        acquiredOn: entry.date,
        acquiredAt: entry.start ?? "12:00",
        cost: Math.abs(entry.amount ?? 0),
        currency: entry.currency ?? settings.bill.currency,
        payment: entry.payment ?? draft.payment ?? defaultPaymentMethodForCalendar(settings, entry.calendar ?? draft.calendarId),
      } : {}),
    });
  }
  async function locate() {
    if (locating || busy) return;
    setLocating(true);
    try {
      const place = await readCurrentPlace(locale);
      if (place) patch({ location: place.label });
    } finally { setLocating(false); }
  }
  return (
    <>
      <div className="title-location-row">
        <label className="field-label field-label--large field-label--title">
          <span>{t("itemName", locale)} <em>*</em></span>
          <input required maxLength={180} value={draft.name} onChange={event => patch({ name: event.target.value })} />
        </label>
        <label className="field-label location-field">
          <span>
            {t("location", locale)}
            <button type="button" className="icon-button location-locate" onClick={() => void locate()} disabled={busy || locating} aria-label={t("useDeviceLocation", locale)}>
              <Icon name="map-pin" size={14} />
            </button>
          </span>
          <div className="location-input-wrap">
            <input ref={locationInput} value={draft.location ?? ""} onChange={event => patch({ location: event.target.value })} placeholder={t("locationPlaceholder", locale)} />
            <FieldSuggestions inputRef={locationInput} locale={locale} suggestions={locationSuggestions} onSelect={value => patch({ location: value })} />
            {Boolean(draft.location) && (
              <button type="button" className="icon-button location-clear" disabled={busy} onClick={() => patch({ location: undefined })} aria-label={t("clearLocation", locale)}>
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
        </label>
      </div>

      <div className="when-groups when-groups--single">
        <div className="when-group">
          <span>{t("itemTime", locale)}</span>
          <div className="when-controls">
            {showDate && (
              <GlassDatePicker value={draft.acquiredOn} ariaLabel={t("itemTime", locale)} locale={locale} clearable={false} hideIcon max={draft.disposedOn || today} onChange={value => patch({ acquiredOn: value ?? draft.acquiredOn })} />
            )}
            <GlassTimePicker value={acquiredTime} locale={locale} ariaLabel={t("itemTime", locale)} clearable={false} hideIcon onChange={value => patch({ acquiredAt: value ?? acquiredTime })} />
          </div>
        </div>
      </div>

      <div className="bill-primary-row">
        <label className="field-label"><span>{t("itemCost", locale)}</span>
          <input type="number" min="0" step="0.01" required value={draft.cost} onChange={event => patch({ cost: Number(event.target.value) })} />
        </label>
        <label className="field-label"><span>{t("currency", locale)}</span>
          <GlassSelect value={draft.currency} ariaLabel={t("currency", locale)} options={[
            ...Object.entries(BUILTIN_CURRENCIES).map(([code, currency]) => ({ value: code, label: locale === "zh" ? currency.name : code })),
            ...Object.keys(settings.bill.customCurrencies).filter(code => !BUILTIN_CURRENCIES[code]).map(code => ({ value: code, label: code })),
          ]} onChange={value => patch({ currency: value })} />
        </label>
        <label className="field-label"><span>{t("payment", locale)}</span>
          <GlassSelect value={draft.payment ?? ""} ariaLabel={t("payment", locale)} options={paymentMethodsForCalendar(settings, draft.calendarId).map(method => ({ value: method.id, label: paymentMethodLabel(method.name, locale) }))} onChange={value => patch({ payment: value || defaultPaymentMethodForCalendar(settings, draft.calendarId) })} />
        </label>
      </div>

      <div className="item-note-link-row">
        <label className="field-label item-note-field"><span>{t("itemNotes", locale)}</span><textarea rows={4} value={draft.notes ?? ""} onChange={event => patch({ notes: event.target.value })} placeholder={t("notePlaceholder", locale)} /></label>
        <div className="item-note-side">
          {draft.acquisition === "purchase" && (
            <BillPicker value={draft.purchaseEntryId} direction="expense" itemId={itemId} onOpenBill={onOpenBill} items={items} entries={entries} settings={settings} locale={locale} name={draft.name} onChange={entry => linkBill(entry)} disabled={busy} />
          )}
          <label className="field-label">{t("itemDisposal", locale)}
            <GlassSelect value={draft.disposal ?? ""} options={[{ value: "", label: t("itemRetained", locale) }, ...Object.entries(itemDisposalLabels).filter(([value]) => value !== "lost").map(([value, label]) => ({ value, label: t(label, locale) }))]} onChange={value => patch({ disposal: (value || undefined) as Item["disposal"], disposedOn: value ? draft.disposedOn ?? today : undefined, ...(value !== "sold" ? { saleEntryId: undefined, saleAmount: undefined } : { saleAmount: draft.saleAmount ?? 0 }) })} disabled={busy} ariaLabel={t("itemDisposal", locale)} />
          </label>
        </div>
      </div>
      {draft.disposal && (
        <label className="field-label">{t("itemDisposedOn", locale)}<input type="date" min={draft.acquiredOn} max={today} required value={draft.disposedOn ?? today} onChange={event => patch({ disposedOn: event.target.value })} /></label>
      )}
      {draft.disposal === "sold" && (
        <>
          <label className="field-label">{t("itemSaleAmount", locale)}<input type="number" min="0" step="0.01" required value={draft.saleAmount ?? 0} onChange={event => patch({ saleAmount: Number(event.target.value) })} /></label>
          <BillPicker value={draft.saleEntryId} direction="income" itemId={itemId} onOpenBill={onOpenBill} items={items} entries={entries.filter(entry => !entry.currency || entry.currency === draft.currency)} settings={settings} locale={locale} name={draft.name} onChange={entry => linkBill(entry, true)} disabled={busy} />
        </>
      )}
      {showPhotos && (
        <ItemPhotoField value={draft.images ?? []} icon={<Icon name={itemCategoryIconName(draft.category, settings, draft.calendarId)} size={20} />} locale={locale} settings={settings} entryDate={draft.acquiredOn} busy={busy} disabled={busy} onChange={images => patch({ images })} onNotice={onError} />
      )}
    </>
  );
}
