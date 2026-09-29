import { useState } from "react";
import { billDirectionForCategory, type Item, type ChronoEonSettings, type Entry, type Locale } from "@chronoeon/domain";
import { t } from "../i18n";
import { itemCategories } from "./ItemsView";
import { GlassSelect } from "./GlassSelect";
import { Icon } from "./Icon";

export function BillItemLinks({ entry, items, locale, settings, onEdit, onLink }: {
  entry: Entry; items: Item[]; locale: Locale; settings: ChronoEonSettings;
  onEdit: (item: Item) => void; onLink: (entry: Entry, item?: Item, category?: Item["category"]) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState<Item["category"]>("other");
  const income = billDirectionForCategory(entry.category, settings) === "income";
  const linked = items.filter(item => item.purchaseEntryId === entry.id || item.saleEntryId === entry.id);
  const available = items.filter(item => income
    ? (!item.disposal || item.disposal === "sold") && !item.saleEntryId && item.currency === (entry.currency ?? settings.bill.currency) && item.acquiredOn <= entry.date
    : item.acquisition === "purchase" && !item.purchaseEntryId);
  return <section className="bill-items" aria-label={t("itemLinked", locale)}>
    <span className="field-label-text"><Icon name="box" size={14} /> {t("itemLinked", locale)}</span>
    {linked.map(item => <button key={item.id} type="button" className="item-bill-link" onClick={() => onEdit(item)}><Icon name="box" size={14} />{item.name}<Icon name="arrow-right" size={12} /></button>)}
    {linked.length === 0 && <div className="bill-items-actions">
      {!income && (creating
        ? <div className="bill-item-create">
            <GlassSelect value={category} ariaLabel={t("itemCategory", locale)}
              options={itemCategories.map(option => ({ value: option.value, label: t(option.label, locale), mark: <Icon name={option.icon} size={13} /> }))}
              onChange={value => setCategory(value as Item["category"])} />
            <button type="button" className="secondary-button" onClick={() => { setCreating(false); onLink(entry, undefined, category); }}>{t("save", locale)}</button>
            <button type="button" className="icon-button" onClick={() => setCreating(false)} aria-label={t("cancel", locale)}><Icon name="close" size={12} /></button>
          </div>
        : <button type="button" className="secondary-button" onClick={() => setCreating(true)}><Icon name="plus" size={14} />{t("itemAdd", locale)}</button>)}
      {available.length > 0 && <GlassSelect value="" options={[{ value: "", label: t("itemLinkExisting", locale) }, ...available.map(item => ({ value: item.id, label: item.name }))]} ariaLabel={t("itemLinkExisting", locale)} onChange={id => { const item = available.find(item => item.id === id); if (item) onLink(entry, item); }} />}
    </div>}
  </section>;
}
