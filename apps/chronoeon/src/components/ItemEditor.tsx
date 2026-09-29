import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { billDirectionForCategory, type Item, type ItemDraft, type ChronoEonSettings, type Entry, type Locale } from "@chronoeon/domain";
import { t } from "../i18n";
import { GlassTimePicker } from "./GlassDateTimePicker";
import { pickItemCover } from "../platform/attachments";
import { ItemCover, acquisitionLabels, itemCategories, itemMoney, disposalLabels } from "./ItemsView";
import { GlassSelect } from "./GlassSelect";
import { Icon } from "./Icon";
import { createMotionPortal as createPortal } from "./MotionPresence";
import { registerModalDismiss } from "./modalLayer";
import "./items.css";

interface ItemEditorProps {
  item?: Item;
  seed?: Partial<ItemDraft>;
  items: Item[];
  entries: Entry[];
  locale: Locale;
  settings: ChronoEonSettings;
  today: string;
  onClose: () => void;
  onSave: (draft: ItemDraft, id?: string) => Promise<void>;
}

function BillPicker({ value, direction, itemId, items, entries, settings, locale, onChange, disabled }: {
  value?: string; direction: "income" | "expense"; itemId?: string; items: Item[]; entries: Entry[];
  settings: ChronoEonSettings; locale: Locale; onChange: (entry?: Entry) => void; disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const eligible = useMemo(() => {
    const taken = new Set(items.filter(item => item.id !== itemId).flatMap(item => [item.purchaseEntryId, item.saleEntryId]).filter(Boolean));
    return entries.filter(entry => entry.kind === "bill" && !taken.has(entry.id) && billDirectionForCategory(entry.category, settings) === direction).sort((a, b) => b.date.localeCompare(a.date));
  }, [items, itemId, direction, entries, settings]);
  const options = eligible.filter(entry => entry.id === value || `${entry.date} ${entry.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const visible = options.slice(0, 80);
  const selected = eligible.find(entry => entry.id === value);
  if (selected && !visible.includes(selected)) visible.unshift(selected);
  const label = t(direction === "expense" ? "itemPurchaseBill" : "itemSaleBill", locale);
  return <div className="item-bill-picker">
    <span className="field-label-text">{label}</span>
    <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("itemBillSearch", locale)} aria-label={`${label} · ${t("search", locale)}`} disabled={disabled} />
    <GlassSelect value={value ?? ""} disabled={disabled} ariaLabel={label} options={[
      { value: "", label: t("itemNoBill", locale) },
      ...(value && !selected ? [{ value, label: t("itemBillMissing", locale) }] : []),
      ...visible.map(entry => ({ value: entry.id, label: `${entry.date} · ${entry.title} · ${itemMoney(Math.abs(entry.amount ?? 0), entry.currency ?? settings.bill.currency, settings, locale)}` })),
    ]} onChange={id => onChange(eligible.find(entry => entry.id === id))} />
  </div>;
}

export function ItemEditor({ item, seed, items, entries, locale, settings, today, onClose, onSave }: ItemEditorProps) {
  const [draft, setDraft] = useState<ItemDraft>(() => ({ name: "", category: "other", acquisition: "purchase", acquiredOn: today, acquiredAt: "12:00", cost: 0, currency: settings.bill.currency, ...(item ?? {}), ...seed }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dismiss = registerModalDismiss(() => { if (!busyRef.current) closeRef.current(); });
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { dismiss(); document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, []);
  function patch(value: Partial<ItemDraft>) { setDraft(current => ({ ...current, ...value })); }
  function linkBill(entry: Entry | undefined, sale = false) {
    if (sale) patch({ saleEntryId: entry?.id, ...(entry ? { disposedOn: entry.date, saleAmount: Math.abs(entry.amount ?? 0) } : {}) });
    else patch({ purchaseEntryId: entry?.id, ...(entry ? { acquiredOn: entry.date, acquiredAt: `${entry.start ?? "12:00"}`, cost: Math.abs(entry.amount ?? 0), currency: entry.currency ?? settings.bill.currency } : {}) });
  }
  async function cover() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { const picked = await pickItemCover(); if (picked) patch({ image: picked.reference }); }
    catch { setError(t("attachmentSaveFailed", locale)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await onSave({ ...draft, name: draft.name.trim() }, item?.id); closeRef.current(); }
    catch { setError(t("itemSaveFailed", locale)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return createPortal(<div className="item-editor-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busyRef.current) onClose(); }}>
    <form ref={dialogRef} className="item-editor panel" role="dialog" aria-modal="true" aria-label={t(item ? "itemEdit" : "itemAdd", locale)} onSubmit={event => void submit(event)} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header className="item-editor-header">
        <h3><Icon name="box" />{t(item ? "itemEdit" : "itemAdd", locale)}</h3>
        <GlassSelect value={draft.category} options={itemCategories.map(option => ({ value: option.value, label: t(option.label, locale), mark: <Icon name={option.icon} size={15} /> }))} onChange={value => patch({ category: value as Item["category"] })} ariaLabel={t("itemCategory", locale)} disabled={busy} />
        <GlassSelect value={draft.acquisition} options={Object.entries(acquisitionLabels).map(([value, label]) => ({ value, label: t(label, locale) }))} onChange={value => patch({ acquisition: value as Item["acquisition"], ...(value !== "purchase" ? { purchaseEntryId: undefined, cost: 0 } : {}) })} ariaLabel={t("itemAcquisition", locale)} disabled={busy} />
        <button type="button" className="icon-button subtle" onClick={onClose} disabled={busy} aria-label={t("close", locale)}><Icon name="close" /></button>
      </header>
      <fieldset disabled={busy} className="item-editor-fields">
        <label className="item-field-wide">{t("itemName", locale)}<input required maxLength={180} value={draft.name} onChange={event => patch({ name: event.target.value })} /></label>
        <label>{t("itemAcquiredOn", locale)}<input type="date" required value={draft.acquiredOn} max={draft.disposedOn || today} onChange={event => patch({ acquiredOn: event.target.value })} /></label>
        <label>{t("itemAcquiredAt", locale)}<GlassTimePicker value={draft.acquiredAt} locale={locale} ariaLabel={t("itemAcquiredAt", locale)} clearable={false} hideIcon onChange={value => patch({ acquiredAt: value ?? draft.acquiredAt })} /></label>
        <label>{t("itemCost", locale)}<input type="number" min="0" step="0.01" required value={draft.cost} onChange={event => patch({ cost: Number(event.target.value) })} /></label>
        <label>{t("currency", locale)}<input required maxLength={12} value={draft.currency} onChange={event => patch({ currency: event.target.value.toUpperCase() })} /></label>
        {draft.acquisition === "purchase" && <div className="item-field-wide"><BillPicker value={draft.purchaseEntryId} direction="expense" itemId={item?.id} items={items} entries={entries} settings={settings} locale={locale} onChange={entry => linkBill(entry)} disabled={busy} /></div>}
        <div className="item-cover-picker item-field-wide"><ItemCover item={draft} locale={locale} /><div><span className="field-label-text">{t("itemCover", locale)}</span><p className="field-hint">{t("itemCoverHint", locale)}</p><div className="item-cover-actions"><button type="button" className="secondary-button" onClick={() => void cover()}><Icon name="image" size={14} />{t("itemCoverPick", locale)}</button>{draft.image && <button type="button" className="secondary-button" onClick={() => patch({ image: undefined })}>{t("itemCoverRemove", locale)}</button>}</div></div></div>
        {item && <label className="item-field-wide">{t("itemDisposal", locale)}<GlassSelect value={draft.disposal ?? ""} options={[{ value: "", label: t("itemsCurrent", locale) }, ...Object.entries(disposalLabels).map(([value, label]) => ({ value, label: t(label, locale) }))]} onChange={value => patch({ disposal: (value || undefined) as Item["disposal"], disposedOn: value ? draft.disposedOn ?? today : undefined, ...(value !== "sold" ? { saleEntryId: undefined, saleAmount: undefined } : { saleAmount: draft.saleAmount ?? 0 }) })} disabled={busy} ariaLabel={t("itemDisposal", locale)} /></label>}
        {draft.disposal && <label>{t("itemDisposedOn", locale)}<input type="date" min={draft.acquiredOn} max={today} required value={draft.disposedOn ?? today} onChange={event => patch({ disposedOn: event.target.value })} /></label>}
        {draft.disposal === "sold" && <><label>{t("itemSaleAmount", locale)}<input type="number" min="0" step="0.01" required value={draft.saleAmount ?? 0} onChange={event => patch({ saleAmount: Number(event.target.value) })} /></label><div className="item-field-wide"><BillPicker value={draft.saleEntryId} direction="income" itemId={item?.id} items={items} entries={entries.filter(entry => !entry.currency || entry.currency === draft.currency)} settings={settings} locale={locale} onChange={entry => linkBill(entry, true)} disabled={busy} /></div></>}
        <label className="item-field-wide">{t("itemNotes", locale)}<textarea rows={2} value={draft.notes ?? ""} onChange={event => patch({ notes: event.target.value })} /></label>
      </fieldset>
      <p className="field-hint">{t("itemBillLinkHint", locale)}</p>
      {error && <p className="item-error" role="alert">{error}</p>}
      <footer className="item-editor-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{t("cancel", locale)}</button><button type="submit" className="primary-button" disabled={busy || !draft.name.trim()}>{t(busy ? "saving" : "save", locale)}</button></footer>
    </form>
  </div>, document.body);
}
