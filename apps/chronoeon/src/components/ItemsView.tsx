import { useMemo } from "react";
import "./items.css";
import { itemDailyCost, itemDaysOwned, currencySymbol, type Item, type ChronoEonSettings, type Entry, type Locale } from "@chronoeon/domain";
import { t, type MessageKey } from "../i18n";
import { usePersistentPreference } from "../hooks/usePersistentPreference";
import { AttachmentThumb } from "./AttachmentThumb";
import { GlassSelect } from "./GlassSelect";
import { Icon, type IconName } from "./Icon";

export const itemCategories: Array<{ value: Item["category"]; label: MessageKey; icon: IconName }> = [
  { value: "electronics", label: "itemElectronics", icon: "device" },
  { value: "clothing", label: "itemClothing", icon: "shirt" },
  { value: "home", label: "itemHome", icon: "home" },
  { value: "transport", label: "itemTransport", icon: "bike" },
  { value: "hobby", label: "itemHobby", icon: "sparkle" },
  { value: "other", label: "itemOther", icon: "box" },
];
export const itemCategory = (category: Item["category"]) => itemCategories.find(option => option.value === category);
export const acquisitionLabels: Record<Item["acquisition"], MessageKey> = { purchase: "itemPurchase", gift: "itemGift", windfall: "itemWindfall" };
export const disposalLabels: Record<NonNullable<Item["disposal"]>, MessageKey> = { sold: "itemSold", lost: "itemLost", discarded: "itemDiscarded" };

export function itemMoney(amount: number, currency: string, settings: ChronoEonSettings, locale: Locale): string {
  return `${currencySymbol(currency, settings)}${amount.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ItemCover({ item, locale }: { item: Pick<Item, "image" | "category">; locale: Locale }) {
  return <span className="item-cover">{item.image
    ? <AttachmentThumb reference={item.image} locale={locale} />
    : <Icon name={itemCategory(item.category)?.icon ?? "box"} size={27} />}</span>;
}

interface ItemsViewProps {
  items: Item[];
  entries: Entry[];
  locale: Locale;
  settings: ChronoEonSettings;
  today: string;
  search?: string;
  onAdd?: () => void;
  onEdit?: (item: Item) => void;
  onOpenBill?: (entry: Entry) => void;
}

type ItemSort = "newest" | "oldest" | "cost" | "daily" | "name";
const sortLabels: Record<ItemSort, MessageKey> = { newest: "itemSortNewest", oldest: "itemSortOldest", cost: "itemSortCost", daily: "itemSortDaily", name: "itemSortName" };

export function ItemsView({ items, entries, locale, settings, today, search = "", onAdd, onEdit, onOpenBill }: ItemsViewProps) {
  const [history, setHistory] = usePersistentPreference("items-history", false);
  const [sort, setSort] = usePersistentPreference<ItemSort>("items-sort", "newest");
  const bills = useMemo(() => new Map(entries.filter(entry => entry.kind === "bill").map(entry => [entry.id, entry])), [entries]);
  const visible = useMemo(() => items.filter(item => Boolean(item.disposal) === history && `${item.name} ${item.notes ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => {
    const byDate = a.acquiredOn.localeCompare(b.acquiredOn);
    const byMoney = (amount: (item: Item) => number) => a.currency.localeCompare(b.currency) || amount(b) - amount(a);
    const result = sort === "oldest" ? byDate : sort === "name" ? a.name.localeCompare(b.name, locale) : sort === "cost" ? byMoney(item => item.cost) : sort === "daily" ? byMoney(item => itemDailyCost(item, today)) : -byDate;
    return result || a.id.localeCompare(b.id);
  }), [items, history, locale, search, sort, today]);

  return <section className="items-view" aria-label={t("items", locale)}>
    <div className="items-toolbar">
      <div className="stats-tabs" role="group" aria-label={t("items", locale)}>
        <button type="button" aria-pressed={!history} className={!history ? "is-active" : ""} onClick={() => setHistory(false)}>{t("itemsCurrent", locale)} <small>{items.filter(item => !item.disposal).length}</small></button>
        <button type="button" aria-pressed={history} className={history ? "is-active" : ""} onClick={() => setHistory(true)}>{t("itemsHistory", locale)} <small>{items.filter(item => item.disposal).length}</small></button>
      </div>
      <GlassSelect value={sort} options={Object.entries(sortLabels).map(([value, label]) => ({ value, label: t(label, locale) }))} onChange={value => setSort(value as ItemSort)} ariaLabel={t("itemSort", locale)} />
      <button type="button" className="primary-button" onClick={onAdd} disabled={!onAdd}><Icon name="plus" size={15} />{t("itemAdd", locale)}</button>
    </div>
    {visible.length === 0 ? <p className="stats-card panel stats-empty">{t(history ? "itemsHistoryEmpty" : "itemsEmpty", locale)}</p> : <ul className="item-list">
      {visible.map(item => <li key={item.id} className="item-card panel">
        <button type="button" className="item-card-main" onClick={() => onEdit?.(item)} aria-label={`${t("itemEdit", locale)} · ${item.name}`}>
          <ItemCover item={item} locale={locale} />
          <span className="item-identity"><strong>{item.name}</strong><small>{t(itemCategory(item.category)?.label ?? "itemOther", locale)} · {t(acquisitionLabels[item.acquisition], locale)}{item.disposal && ` · ${t(disposalLabels[item.disposal], locale)}`}</small></span>
          <Icon name="edit" size={14} />
        </button>
        <dl className="item-facts">
          <div><dt>{t("itemAcquiredOn", locale)}</dt><dd>{`${item.acquiredOn} ${item.acquiredAt}`}</dd></div>
          <div><dt>{t("itemDaysOwned", locale)}</dt><dd>{itemDaysOwned(item, today)}</dd></div>
          <div><dt>{t("itemCost", locale)}</dt><dd>{itemMoney(item.cost, item.currency, settings, locale)}</dd></div>
          <div><dt>{t("itemDailyCost", locale)}</dt><dd>{itemMoney(itemDailyCost(item, today), item.currency, settings, locale)}</dd></div>
        </dl>
        {item.disposal && <p className="item-history-line">{t(disposalLabels[item.disposal], locale)} · {item.disposedOn}{item.disposal === "sold" && ` · ${itemMoney(item.saleAmount ?? 0, item.currency, settings, locale)}`}</p>}
        {(item.purchaseEntryId || item.saleEntryId) && <div className="item-bill-links">{[item.purchaseEntryId, item.saleEntryId].filter(Boolean).map(id => {
          const entry = bills.get(id!);
          return <button key={id} type="button" className="item-bill-link" disabled={!entry || !onOpenBill} onClick={() => entry && onOpenBill?.(entry)}><Icon name="coins" size={12} />{entry ? `${entry.date} · ${entry.title}` : t("itemBillMissing", locale)}</button>;
        })}</div>}
      </li>)}
    </ul>}
    <p className="field-hint">{t("itemCostHint", locale)}</p>
  </section>;
}
