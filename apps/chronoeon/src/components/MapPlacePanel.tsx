import { useMemo } from "react";
import { categoryOptionsForKind, resolveEntryColors, type ChronoEonSettings, type Entry, type GeoCluster, type Item, type Locale } from "@chronoeon/domain";
import { categoryLabel, t } from "../i18n";
import { useAttachmentUrls } from "../hooks/useAttachmentUrls";
import { Icon } from "./Icon";
import { ItemChip } from "./ItemChip";
import { itemCategoryConfig, itemCategoryLabel } from "./ItemsView";
import { PhotoFrame } from "./PhotoFrame";

export function MapPlacePanel({ selected, groups, locale, settings, expanded, photosOnly, onExpanded, onPhotosOnly, onClose, onFocus, onOpenEntry, onOpenItem, onPick, onRetry, onExclude }: {
  selected: GeoCluster; groups: GeoCluster[]; locale: Locale; settings: ChronoEonSettings; expanded: boolean; photosOnly: boolean;
  onExpanded: (expanded: boolean) => void; onPhotosOnly: (photos: boolean) => void; onClose: () => void; onFocus: (cluster: GeoCluster) => void;
  onOpenEntry: (entry: Entry) => void; onOpenItem: (item: Item) => void; onPick?: () => void; onRetry?: () => void; onExclude?: () => void;
}) {
  const zh = locale === "zh";
  const sorted = useMemo(() => groups.map(cluster => ({ ...cluster, records: [...cluster.records].sort((a, b) => b.date.localeCompare(a.date) || (b.start ?? "").localeCompare(a.start ?? "")) })), [groups]);
  const refs = useMemo(() => photosOnly && expanded ? sorted.flatMap(group => group.records.flatMap(record => record.images)) : [], [sorted, photosOnly, expanded]);
  const resolved = useAttachmentUrls(refs);
  const shownGroups = photosOnly ? sorted.filter(group => group.photos > 0) : sorted;
  const count = groups.reduce((sum, group) => sum + group.count, 0);
  return <aside className={`map-place-panel${expanded ? "" : " is-collapsed"}`} aria-label={zh ? "地点记录" : "Place records"}>
    <header><button type="button" className="map-panel-toggle" onClick={() => onExpanded(!expanded)} aria-expanded={expanded} aria-label={zh ? (expanded ? "收起地点记录" : "展开地点记录") : (expanded ? "Collapse place records" : "Expand place records")}>
      <span className="map-panel-emblem"><Icon name="map-pin" size={17} /></span><span><strong>{selected.address}</strong><small>{groups.length > 1 ? (zh ? `${groups.length} 个附近地点 · ` : `${groups.length} nearby places · `) : ""}{zh ? `${count} 条记录` : `${count} records`}</small></span><Icon name={expanded ? "chevron-up" : "chevron-down"} size={13} />
    </button><button type="button" className="icon-button subtle" aria-label={t("close", locale)} title={t("close", locale)} onClick={onClose}><Icon name="close" size={14} /></button></header>
    {expanded && <><div className="map-panel-toolbar"><span>{zh ? "按地点整理" : "Grouped by place"}</span><button type="button" className={photosOnly ? "is-active" : ""} aria-pressed={photosOnly} onClick={() => onPhotosOnly(!photosOnly)}><Icon name={photosOnly ? "agenda" : "image"} size={13} />{t("mapPhotosOnly", locale)}</button></div>
      <div className="map-place-groups">{!shownGroups.length && <p className="stats-empty">{t("mapNoPhotos", locale)}</p>}{shownGroups.map(group => {
        const visible = photosOnly ? group.records.filter(record => record.images.length) : group.records;
        return <details key={group.address} className="map-place-group" open>
          <summary><span className={group.precision === "approximate" ? "map-group-dot is-approximate" : "map-group-dot"} /><strong>{group.address}</strong><span>{visible.length}</span></summary>
          <div className="map-group-meta"><span>{group.first}{group.first !== group.last ? ` — ${group.last}` : ""}</span><button type="button" onClick={() => onFocus(group)} title={zh ? "放大到此地点" : "Zoom to this place"}><Icon name="target" size={12} />{zh ? "定位" : "Focus"}</button></div>
          {group.addresses.length > 1 && <p className="map-aliases">{group.addresses.slice(1).join(" · ")}</p>}
          {photosOnly ? <div className="photo-wall-items map-place-photos">{visible.map(record => {
            const urls = record.images.map(reference => resolved[reference]).filter(Boolean);
            if (!urls.length) return <p key={record.id} className="map-photo-pending">{record.title} · {record.images.every(reference => reference in resolved) ? (zh ? "图片无法读取" : "Photos unavailable") : (zh ? "图片加载中" : "Loading photos")}</p>;
            const entry = record.entry, item = record.item;
            const option = entry ? categoryOptionsForKind(entry.kind, settings, entry.calendar).find(option => option.value === entry.category) : undefined;
            return <PhotoFrame key={record.id} title={record.title} note={entry?.note ?? item?.notes} location={record.address} urls={urls} locale={locale} kind={entry?.kind ?? "item"} category={entry ? categoryLabel(entry.category, locale, option?.label, settings) : item ? itemCategoryLabel(item.category, locale, settings, item.calendarId) : ""} accent={entry ? resolveEntryColors(entry, settings).accent : item ? itemCategoryConfig(item.category, settings, item.calendarId)?.color ?? "var(--accent)" : "var(--accent)"} meta={`${record.date}${record.start ? ` · ${record.start}` : ""}`} />;
          })}{!visible.length && <p className="stats-empty">{t("mapNoPhotos", locale)}</p>}</div> : <ol className="map-record-list">{visible.map(record => <li key={record.id}>{record.entry ? <ItemChip entry={record.entry} settings={settings} locale={locale} variant="list" onOpen={onOpenEntry} /> : <button type="button" className="map-item-row" onClick={() => record.item && onOpenItem(record.item)}><Icon name="box" size={14} /><span>{record.title}</span><small>{record.date}</small></button>}</li>)}</ol>}
        </details>;
      })}</div>
      {(onPick || onRetry || onExclude) && <footer aria-label={selected.address}>
        {onPick && <button type="button" className="secondary-button" onClick={onPick}><Icon name="map" size={12} />{zh ? "地图选点" : "Pick on map"}</button>}
        {onRetry && <button type="button" className="secondary-button" onClick={onRetry}><Icon name="refresh" size={12} />{t("mapRetry", locale)}</button>}
        {onExclude && <button type="button" className="secondary-button" onClick={onExclude}><Icon name="eye-off" size={12} />{t("mapExclude", locale)}</button>}
      </footer>}
    </>}
  </aside>;
}
