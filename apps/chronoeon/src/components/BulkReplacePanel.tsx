import { useState } from "react";
import type { Entry, Item, Locale } from "@chronoeon/domain";
import { t, type MessageKey } from "../i18n";
import { REPLACE_FIELDS, replacementPreview, applyReplacements, itemReplacementPreview, applyItemReplacements, type ReplaceRecords, type ReplacementRow, type ReplaceField } from "../domain/bulkReplace";
import { Icon } from "./Icon";
const labels: Record<ReplaceField, MessageKey> = { title: "title", titleZh: "bulkTitleZh", location: "searchFieldLocation", note: "searchFieldNote", category: "searchFieldCategory", payment: "searchFieldPayment", tags: "searchFieldTag" };

export function BulkReplacePanel({ entries, items, search, locale, onReplace }: { entries: Entry[]; items: Item[]; search: string; locale: Locale; onReplace: ReplaceRecords }) {
  const [open, setOpen] = useState(false), [replacement, setReplacement] = useState("");
  const [field, setField] = useState<ReplaceField | "all">("all");
  const [review, setReview] = useState<ReplacementRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(30), [busy, setBusy] = useState(false), [message, setMessage] = useState<MessageKey | null>(null);
  if (!search.trim()) return null;
  const rows = review ?? [];
  return <section className="bulk-replace">
    <button type="button" className="secondary-button" disabled={busy} aria-expanded={open} onClick={() => { setOpen(!open); setReview(null); setMessage(null); }}><Icon name="edit" size={13} />{t("bulkReplace", locale)}</button>
    {open && <div className="bulk-replace-form">
      <p>{t("bulkPreview", locale)}</p>
      <label>{t("filterSearch", locale)}<input value={search} readOnly /></label>
      <label>{t("bulkField", locale)}<select value={field} disabled={busy} onChange={event => { setField(event.target.value as ReplaceField | "all"); setReview(null); }}><option value="all">{t("bulkAllFields", locale)}</option>{REPLACE_FIELDS.map(key => <option key={key} value={key}>{t(labels[key], locale)}</option>)}</select></label>
      <label>{t("bulkReplacement", locale)}<input value={replacement} disabled={busy} onChange={event => { setReplacement(event.target.value); setReview(null); setMessage(null); }} /></label>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => { const rows = [...replacementPreview(entries, search.trim(), replacement, field), ...itemReplacementPreview(items, search.trim(), replacement, field)]; setReview(rows); setSelected(new Set(rows.map(row => row.key))); setLimit(30); setMessage(null); }}>{t("bulkShowPreview", locale)}</button>
      {review && <>
        <label className="bulk-select-all"><input type="checkbox" disabled={busy || !rows.length} checked={rows.length > 0 && selected.size === rows.length} onChange={event => setSelected(new Set(event.target.checked ? rows.map(row => row.key) : []))} />{t("filterSelectAll", locale)} · {selected.size}/{rows.length}</label>
        {!rows.length && <p>{t("filterNoResults", locale)}</p>}
        <div className="bulk-preview-list">{rows.slice(0, limit).map(row => <label className="bulk-preview-row" key={row.key}>
          <input type="checkbox" disabled={busy} checked={selected.has(row.key)} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })} />
          <span><strong>{"entry" in row ? row.entry.title : `${t("items", locale)} · ${row.item.name}`} · {t(labels[row.field], locale)}</strong><del>{row.before}</del><ins>{row.after || t("bulkEmpty", locale)}</ins></span>
        </label>)}</div>
        {rows.length > limit && <button type="button" className="secondary-button" onClick={() => setLimit(value => value + 30)}>{t("filterSearchMore", locale)}</button>}
        <button type="button" className="primary-action" disabled={busy || !selected.size} onClick={async () => {
          setBusy(true); setMessage(null);
          try { const chosen = rows.filter(row => selected.has(row.key));
          await onReplace(applyReplacements(chosen.filter(row => "entry" in row)), applyItemReplacements(chosen.filter(row => "item" in row))); setReview(null); setMessage("bulkDone"); }
          catch { setMessage("bulkFailed"); }
          finally { setBusy(false); }
        }}>{busy ? t("loading", locale) : t("bulkApply", locale)} ({selected.size})</button>
      </>}
      {message && <p role="status">{t(message, locale)}</p>}
    </div>}
  </section>;
}
