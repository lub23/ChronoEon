import { useMemo } from "react";
import "./items.css";
import { itemCategoriesForCalendar, itemDailyCost, itemDaysOwned, currencySymbol, selectedCalendar, type Item, type ChronoEonSettings, type Entry, type Locale } from "@chronoeon/domain";
import { t, type MessageKey } from "../i18n";
import { usePersistentPreference } from "../hooks/usePersistentPreference";
import { openImagePreview } from "./photoPreviewBus";
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
export const itemIconChoices: Array<{ value: string; icon: IconName; en: string; zh: string }> = [
  { value: "electronics", icon: "device", en: "Electronics", zh: "电子产品" },
  { value: "clothing", icon: "shirt", en: "Clothing", zh: "衣物" },
  { value: "home", icon: "home", en: "Home", zh: "家居" },
  { value: "transport", icon: "bike", en: "Transport", zh: "出行" },
  { value: "hobby", icon: "sparkle", en: "Hobbies", zh: "爱好" },
  { value: "other", icon: "box", en: "Other", zh: "其他" },
  { value: "book", icon: "book", en: "Books", zh: "书籍" },
  { value: "camera", icon: "camera", en: "Cameras", zh: "摄影" },
  { value: "gift", icon: "box", en: "Gifts", zh: "礼物" },
  { value: "leaf", icon: "leaf", en: "Plants", zh: "植物" },
  { value: "watch", icon: "clock", en: "Watches", zh: "钟表" },
  { value: "sport", icon: "target", en: "Sports", zh: "运动" },
];
export const resolveItemIcon = (key?: string): IconName => itemIconChoices.find(option => option.value === key)?.icon ?? "box";
export const itemCategory = (category: Item["category"]) => itemCategories.find(option => option.value === category);
export function itemCategoryConfig(category: Item["category"], settings: ChronoEonSettings, calendarId?: string) {
  return itemCategoriesForCalendar(settings, calendarId).find(option => option.id === category);
}
export function itemCategoryIconName(category: Item["category"], settings: ChronoEonSettings, calendarId?: string): IconName {
  const configured = itemCategoryConfig(category, settings, calendarId);
  const key = configured?.icon ?? category;
  return resolveItemIcon(key);
}
export function itemCategoryLabel(category: Item["category"], locale: Locale, settings: ChronoEonSettings, calendarId?: string): string {
  const configured = itemCategoryConfig(category, settings, calendarId)?.name;
  if (configured) return configured;
  const builtin = itemCategory(category);
  return builtin ? t(builtin.label, locale) : category;
}
export const acquisitionLabels: Record<Item["acquisition"], MessageKey> = { purchase: "itemPurchase", gift: "itemGift", windfall: "itemWindfall" };
export const disposalLabels: Record<NonNullable<Item["disposal"]>, MessageKey> = { sold: "itemSold", lost: "itemLost", discarded: "itemDiscarded" };

export function itemMoney(amount: number, currency: string, settings: ChronoEonSettings, locale: Locale): string {
  return `${currencySymbol(currency, settings)}${amount.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ItemCover({ item, locale, settings }: { item: Pick<Item, "images" | "category" | "calendarId">; locale: Locale; settings: ChronoEonSettings }) {
  return <span className="item-cover">{item.images?.[0]
    ? <button type="button" className="item-photo-preview" aria-label={t("photoPreview", locale)} onClick={event => { event.stopPropagation(); openImagePreview(item.images!); }}><AttachmentThumb reference={item.images[0]} locale={locale} /></button>
    : <Icon name={itemCategoryIconName(item.category, settings, item.calendarId)} size={27} />}</span>;
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

type ItemSortField = "date" | "cost" | "daily" | "name";
type ItemSortDirection = "asc" | "desc";
const sortLabels: Record<ItemSortField, MessageKey> = { date: "itemSortDate", cost: "itemSortCost", daily: "itemSortDaily", name: "itemSortName" };

export function ItemsView({ items, entries, locale, settings, today, search = "", onAdd, onEdit, onOpenBill }: ItemsViewProps) {
  const [history, setHistory] = usePersistentPreference("items-history", false);
  const [sortField, setSortField] = usePersistentPreference<ItemSortField>("items-sort-field", "date");
  const [sortDirection, setSortDirection] = usePersistentPreference<ItemSortDirection>("items-sort-direction", "desc");
  const bills = useMemo(() => new Map(entries.filter(entry => entry.kind === "bill").map(entry => [entry.id, entry])), [entries]);
  const visible = useMemo(() => items.filter(item => Boolean(item.disposal) === history && `${item.name} ${item.notes ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => {
    const byDate = a.acquiredOn.localeCompare(b.acquiredOn);
    const byMoney = (amount: (item: Item) => number) => a.currency.localeCompare(b.currency) || amount(b) - amount(a);
    const natural = sortField === "date" ? byDate : sortField === "name" ? a.name.localeCompare(b.name, locale) : sortField === "cost" ? byMoney(item => item.cost) : byMoney(item => itemDailyCost(item, today));
    const result = sortDirection === "desc" ? -natural : natural;
    return result || a.id.localeCompare(b.id);
  }), [items, history, locale, search, sortDirection, sortField, today]);

  const clockTime = (value: string) => value.match(/(?:T|\s)(\d{2}:\d{2})$/)?.[1] ?? value;

  const calendarNameFor = (item: Item) => {
    const calendar = selectedCalendar(settings, item.calendarId);
    return calendar.name.trim().toLowerCase() === "default"
      ? t("defaultCalendarName", locale)
      : calendar.name;
  };

  const signatureInitial = (item: Item) => {
    const first = [...calendarNameFor(item).trim()][0] ?? "";
    return /[a-z]/i.test(first) ? first.toUpperCase() : first;
  };

  return <section className="items-view" aria-label={t("items", locale)}>
    <div className="items-toolbar page-title-row view-title-row">
      <h2 className="view-heading"><span className="headline-leaf">{t("insightsTitle", locale)}</span></h2>
      <div className="items-toolbar-controls">
        <GlassSelect value={sortField} options={Object.entries(sortLabels).map(([value, label]) => ({ value, label: t(label, locale) }))} onChange={value => setSortField(value as ItemSortField)} ariaLabel={t("itemSort", locale)} />
        <GlassSelect value={sortDirection} options={[{ value: "asc", label: t("sortAscending", locale) }, { value: "desc", label: t("sortDescending", locale) }]} onChange={value => setSortDirection(value as ItemSortDirection)} ariaLabel={sortDirection === "asc" ? t("sortAscending", locale) : t("sortDescending", locale)} />
        <button type="button" className="primary-button items-add-button" onClick={onAdd} disabled={!onAdd} aria-label={t("itemAdd", locale)}><Icon name="plus" size={16} /></button>
      </div>
    </div>
    <div className="stats-tabs items-history-tabs" role="group" aria-label={t("items", locale)}>
      <button type="button" aria-pressed={!history} className={!history ? "is-active" : ""} onClick={() => setHistory(false)}>{t("itemsCurrent", locale)} <small>{items.filter(item => !item.disposal).length}</small></button>
      <button type="button" aria-pressed={history} className={history ? "is-active" : ""} onClick={() => setHistory(true)}>{t("itemsHistory", locale)} <small>{items.filter(item => item.disposal).length}</small></button>
    </div>
    {visible.length === 0 ? <p className="stats-card panel stats-empty">{t(history ? "itemsHistoryEmpty" : "itemsEmpty", locale)}</p> : <ul className="item-list">
      {visible.map(item => {
        const category = itemCategoryConfig(item.category, settings, item.calendarId);
        const calendarName = calendarNameFor(item);
        return <li key={item.id} className="item-card panel" style={{ "--item-category": category?.color ?? "var(--accent)", "--item-calendar": selectedCalendar(settings, item.calendarId).color } as React.CSSProperties}>
        <div className="item-card-top">
          <div className="item-card-main">
            <ItemCover item={item} locale={locale} settings={settings} />
            <button type="button" className="item-identity" onClick={() => onEdit?.(item)} aria-label={`${t("itemEdit", locale)} · ${item.name}`}><strong>{item.name}</strong><small>{itemCategoryLabel(item.category, locale, settings, item.calendarId)} · {t(acquisitionLabels[item.acquisition], locale)}{item.disposal && ` · ${t(disposalLabels[item.disposal], locale)}`}</small></button>
          </div>
          <button type="button" className="item-card-action" onClick={() => onEdit?.(item)} aria-label={`${t("itemEdit", locale)} · ${item.name}`} title={t("itemEdit", locale)}><Icon name="edit" size={15} /></button>
        </div>
        <dl className="item-facts">
          <div><dt>{t("itemTime", locale)}</dt><dd>{`${item.acquiredOn} ${clockTime(item.acquiredAt)}`}</dd></div>
          <div><dt>{t("itemDaysOwned", locale)}</dt><dd>{itemDaysOwned(item, today)}</dd></div>
          <div><dt>{t("itemCost", locale)}</dt><dd>{itemMoney(item.cost, item.currency, settings, locale)}</dd></div>
          <div><dt>{t("itemDailyCost", locale)}</dt><dd>{itemMoney(itemDailyCost(item, today), item.currency, settings, locale)}</dd></div>
        </dl>
        <footer className="item-card-footer">
          <div className="item-card-secondary">
            {item.disposal && <p className="item-history-line">{t(disposalLabels[item.disposal], locale)} · {item.disposedOn}{item.disposal === "sold" && ` · ${itemMoney(item.saleAmount ?? 0, item.currency, settings, locale)}`}</p>}
            {(item.purchaseEntryId || item.saleEntryId) && <div className="item-bill-links">{[item.purchaseEntryId, item.saleEntryId].filter(Boolean).map(id => {
              const entry = bills.get(id!);
              return <button key={id} type="button" className="item-bill-link" disabled={!entry || !onOpenBill} onClick={() => entry && onOpenBill?.(entry)}><Icon name="coins" size={12} />{entry ? `${entry.date} · ${entry.title}` : t("itemBillMissing", locale)}</button>;
            })}</div>}
          </div>
          <span className="item-calendar-seal" title={calendarName} aria-label={calendarName}>{signatureInitial(item)}</span>
        </footer>
      </li>;
      })}
    </ul>}
  </section>;
}
