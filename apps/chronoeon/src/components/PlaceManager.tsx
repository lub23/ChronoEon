import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { normalizeAddress, type GeoPoint, type Locale } from "@chronoeon/domain";
import { geocodeAddress, geocodeConfigured } from "../platform/geocode";
import { placeNameCandidates } from "../platform/location";
import { usePlaceServices } from "./PlaceServices";
import { GlassSelect } from "./GlassSelect";
import { FieldSuggestions } from "./FieldSuggestions";
import { Icon } from "./Icon";
const Picker = lazy(() => import("./MapPointPicker").then(module => ({ default: module.MapPointPicker })));

export function PlaceManager({ locale }: { locale: Locale }) {
  const { addresses, counts, places, cache, rename, config } = usePlaceServices();
  const [selected, setSelected] = useState("");
  const [baseline, setBaseline] = useState<{ name: string; point?: GeoPoint }>({ name: "" });
  const [name, setName] = useState("");
  const [lng, setLng] = useState("");
  const [lat, setLat] = useState("");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [sort, setSort] = useState<{ column: "name" | "count"; ascending: boolean }>({ column: "count", ascending: false });
  const nameInput = useRef<HTMLInputElement>(null);
  const pickInitial = useRef<GeoPoint | undefined>(undefined);
  const zh = locale === "zh";
  const valid = lng.trim() !== "" && lat.trim() !== "" && Number.isFinite(Number(lng)) && Number.isFinite(Number(lat)) && Math.abs(Number(lng)) <= 180 && Math.abs(Number(lat)) <= 90;
  const nameDirty = normalizeAddress(name) !== baseline.name;
  const lngDirty = baseline.point ? Number(lng) !== baseline.point.lng || !lng.trim() : Boolean(lng.trim());
  const latDirty = baseline.point ? Number(lat) !== baseline.point.lat || !lat.trim() : Boolean(lat.trim());
  const dirty = nameDirty || lngDirty || latDirty;
  const duplicate = nameDirty && addresses.includes(normalizeAddress(name));
  const options = useMemo(() => [...addresses].sort((a, b) => ((sort.column === "name" ? a.localeCompare(b, locale) : (counts?.get(a) ?? 0) - (counts?.get(b) ?? 0)) || a.localeCompare(b, locale)) * (sort.ascending ? 1 : -1)).map(address => {
    const point = places.get(address);
    return { value: address, label: `${address} · ${counts?.get(address) ?? 0}`, description: point ? `${point.lng.toFixed(6)}, ${point.lat.toFixed(6)} · WGS84` : (zh ? "尚未获取经纬度" : "Coordinates not acquired"), color: point ? "var(--green)" : "var(--ink-faint)" };
  }), [addresses, places, counts, sort, locale, zh]);
  function select(address: string) {
    const point = places.get(address);
    setSelected(address); setName(address); setBaseline({ name: address, point });
    setLng(point ? String(point.lng) : ""); setLat(point ? String(point.lat) : ""); setMessage(""); setNames([]); setPending(null);
  }
  async function act(work: () => Promise<void>, success: string) {
    setBusy(true); setMessage("");
    try { await work(); setMessage(success); } catch { setMessage(zh ? "操作失败，未保存的修改仍保留，请检查服务或网络后重试" : "Operation failed. Your edits are kept; check service and connection."); } finally { setBusy(false); }
  }
  const changed = <i className="place-unsaved" title={zh ? "未保存" : "Unsaved"} aria-label={zh ? "未保存" : "Unsaved"} />;
  return <section className="place-manager"><header className="place-manager-heading"><h4>{zh ? "地点与经纬度" : "Places and coordinates"} <small>WGS84</small></h4>
    <div className="place-sort-tools" role="group" aria-label={zh ? "地点排序" : "Sort places"}>{(["name", "count"] as const).map(column => <button type="button" key={column} className={sort.column === column ? "is-active" : ""} onClick={() => setSort(current => ({ column, ascending: current.column === column ? !current.ascending : column === "name" }))}>{column === "name" ? (zh ? "名称" : "Name") : (zh ? "数量" : "Count")}{sort.column === column ? (sort.ascending ? " ↑" : " ↓") : " ↕"}</button>)}</div>
    </header><GlassSelect className="place-manager-select" value={selected} ariaLabel={zh ? "地点列表" : "Places"} disabled={busy || !addresses.length} options={[{ value: "", label: zh ? "选择地点" : "Choose a place" }, ...options]} onChange={address => { if (dirty && address !== selected) setPending(address); else select(address); }} />
    {pending !== null && <div className="place-switch-confirm" role="status"><span>{zh ? "当前修改尚未保存" : "You have unsaved edits"}</span><button type="button" onClick={() => setPending(null)}>{zh ? "继续编辑" : "Keep editing"}</button><button type="button" onClick={() => select(pending)}>{zh ? "放弃并切换" : "Discard and switch"}</button></div>}
    {selected && <><div className="place-manager-fields">
      <label className="field-label"><span>{zh ? "地点名称" : "Place name"}{nameDirty && changed}</span><div className="location-input-wrap"><input ref={nameInput} value={name} disabled={busy} onChange={event => { setName(event.target.value); setNames([]); }} /><FieldSuggestions inputRef={nameInput} locale={locale} suggestions={names.map(value => ({ value }))} onSelect={setName} /></div></label>
      <label className="field-label"><span>{zh ? "经度" : "Longitude"}{lngDirty && changed}</span><input type="number" step="any" min="-180" max="180" value={lng} disabled={busy} onChange={event => setLng(event.target.value)} /></label>
      <label className="field-label"><span>{zh ? "纬度" : "Latitude"}{latDirty && changed}</span><input type="number" step="any" min="-90" max="90" value={lat} disabled={busy} onChange={event => setLat(event.target.value)} /></label>
    </div><div className="place-manager-actions">
      <button className="secondary-button" type="button" disabled={busy || !valid} onClick={() => void act(async () => { const candidates = await placeNameCandidates({ lng: Number(lng), lat: Number(lat) }, locale, config); if (!candidates.length) throw new Error("No names"); setNames(candidates); setName(candidates[0]); nameInput.current?.focus({ preventScroll: true }); }, zh ? "名称已填入，点击更新后保存" : "Name filled. Choose Update to save.")}><Icon name="map-pin" size={13} />{zh ? "获取名称" : "Look up name"}</button>
      <button className="secondary-button" type="button" disabled={busy || !name.trim() || !config || !geocodeConfigured(config)} onClick={() => void act(async () => { const result = await geocodeAddress(config!, name.trim()); if (!result?.ok || result.lng === null || result.lat === null || (result.score ?? 0) < 70) throw new Error("Imprecise"); setLng(String(result.lng)); setLat(String(result.lat)); }, zh ? "经纬度已填入，点击更新后保存" : "Coordinates filled. Choose Update to save.")}><Icon name="refresh" size={13} />{zh ? "获取经纬度" : "Look up coordinates"}</button>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => { pickInitial.current = valid ? { lng: Number(lng), lat: Number(lat) } : undefined; setPicking(true); }}><Icon name="map" size={13} />{zh ? "地图选点" : "Pick on map"}</button>
      <button className="primary-action place-update" type="button" disabled={busy || !dirty || !name.trim() || duplicate || ((lngDirty || latDirty) && !valid)} onClick={() => void act(async () => {
        const next = normalizeAddress(name);
        if (next !== selected) await rename(selected, next);
        if (valid && (lngDirty || latDirty)) await cache(next, { lng: Number(lng), lat: Number(lat) }, "manual", 100);
        setSelected(next); setName(next); setBaseline({ name: next, point: valid ? { lng: Number(lng), lat: Number(lat) } : undefined }); setNames([]);
      }, zh ? "地点已更新" : "Place updated")}><Icon name="check" size={13} />{zh ? "更新" : "Update"}</button>
    </div><p className="settings-footnote" role="status">{duplicate ? (zh ? "此名称已存在，请选择不同名称" : "This name already exists. Choose a different name.") : message || (zh ? "灰点表示未保存修改，只有点击更新才会写入数据库。" : "Grey dots mark unsaved edits. Only Update writes to the database.")}</p></>}
    {picking && <Suspense fallback={<p role="status">{zh ? "正在打开地图…" : "Opening map…"}</p>}><Picker locale={locale} initial={pickInitial.current} onClose={() => setPicking(false)} onSelect={point => { setLng(String(point.lng)); setLat(String(point.lat)); setPicking(false); setMessage(zh ? "经纬度已填入，点击更新后保存" : "Coordinates filled. Choose Update to save."); }} /></Suspense>}
  </section>;
}
