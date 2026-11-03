import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { nearestPlaces, normalizeAddress, type GeoPlace, type GeoPoint, type Locale } from "@chronoeon/domain";
import { requestCoordinates, readNearbyPlace } from "../platform/location";
import { geocodeAddress, geocodeConfigured } from "../platform/geocode";
import { usePlaceServices } from "./PlaceServices";
import { FieldSuggestions } from "./FieldSuggestions";
import { Icon } from "./Icon";
import { t } from "../i18n";
const Picker = lazy(() => import("./MapPointPicker").then(module => ({ default: module.MapPointPicker })));

export function LocationField({ value = "", onChange, locale, disabled = false, suggestions = [], places: supplied = [], onPlaceLocated, auto = true }: {
  value?: string; onChange: (value: string | undefined) => void; locale: Locale; disabled?: boolean;
  suggestions?: Array<{ value: string }>; places?: GeoPlace[]; onPlaceLocated?: (address: string, point: GeoPoint) => void; auto?: boolean;
}) {
  const services = usePlaceServices();
  const places = services.places.size ? [...services.places.values()] : supplied;
  const latest = useRef({ value, places }); latest.current = { value, places };
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const fixes = useRef(new Map<string, GeoPoint>());
  const [nearby, setNearby] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState<{ address: string; point: GeoPoint } | null>(null);
  const [picking, setPicking] = useState(false);
  const zh = locale === "zh";
  const known = places.find(place => place.address === normalizeAddress(value) && (place.score ?? 0) >= 70);
  const storedPoint = known ?? (saved?.address === value.trim() ? saved.point : undefined);
  const initialPoint = useRef<GeoPoint | undefined>(undefined);
  useEffect(() => {
    if (!auto || disabled) return;
    let active = true;
    void requestCoordinates().then(fix => {
      if (active && fix) setNearby(nearestPlaces({ lng: fix.longitude, lat: fix.latitude }, latest.current.places).map(hit => hit.place.address));
    });
    return () => { active = false; sequence.current += 1; };
  }, [auto, disabled]);
  function announce(text: string) { setMessage(text); services.notice?.(text); }
  async function save(address: string, point: GeoPoint, level = "manual", score = 100) {
    if (services.config) await services.cache(address, point, level, score);
    else if (onPlaceLocated) await onPlaceLocated(address, point);
    else throw new Error("Place storage unavailable");
    setSaved({ address, point });
  }
  async function choose(name: string, point?: GeoPoint) {
    const request = ++sequence.current;
    onChange(name);
    setMessage("");
    const existing = latest.current.places.find(place => place.address === name && (place.score ?? 0) >= 70);
    if (existing && !point) { setState("idle"); return; }
    const selectedPoint = point ?? fixes.current.get(name);
    if (!selectedPoint) { setState("idle"); return; }
    setState("busy");
    try { await save(name, selectedPoint, point ? "manual" : "gps"); if (request === sequence.current) { setState("idle"); announce(zh ? "经纬度已保存" : "Coordinates saved"); } }
    catch { if (request === sequence.current) { setState("error"); announce(zh ? "保存失败，请重试" : "Save failed. Please retry."); } }
  }
  async function run(mode: "gps" | "refresh") {
    const request = ++sequence.current;
    const address = value.trim();
    setState("busy"); setMessage(zh ? "正在获取…" : "Locating…");
    try {
      if (mode === "gps") {
        const place = await readNearbyPlace(locale, latest.current.places, true, services.config);
        if (request !== sequence.current) return;
        if (!place?.candidates.length) throw new Error("unavailable");
        fixes.current = new Map(place.candidates.map(name => [name, place.candidatePlaces?.find(candidate => candidate.address === name) ?? latest.current.places.find(candidate => candidate.address === name) ?? { lng: place.longitude, lat: place.latitude }]));
        setNearby(place.candidates);
        await choose(place.candidates[0]);
        input.current?.focus({ preventScroll: true });
      } else {
        if (!services.config || !address) return;
        const result = await geocodeAddress(services.config, address);
        if (request !== sequence.current || latest.current.value.trim() !== address) return;
        if (!result?.ok || result.lng === null || result.lat === null || (result.score ?? 0) < 70) throw new Error("imprecise");
        await save(address, { lng: result.lng, lat: result.lat }, result.level ?? "geocode", result.score!);
        if (request === sequence.current) { setState("idle"); announce(zh ? "经纬度已保存" : "Coordinates saved"); }
      }
    } catch { if (request === sequence.current) { setState("error"); announce(zh ? "定位失败或结果不够准确，可重试或地图选点" : "Location unavailable or imprecise. Retry or pick on map."); } }
  }
  const status = state === "busy" ? "busy" : state === "error" ? "error" : storedPoint ? "saved" : "idle";
  const statusText = state === "busy" ? (zh ? "获取中" : "Locating") : state === "error" ? message : storedPoint ? `${zh ? "经纬度已保存" : "Coordinates saved"} · ${storedPoint.lng.toFixed(6)}, ${storedPoint.lat.toFixed(6)}` : (zh ? "尚未保存经纬度" : "Coordinates not saved");
  const candidates = [...new Set([...nearby, ...suggestions.map(item => item.value), ...services.addresses.filter(address => value && address.toLocaleLowerCase().includes(value.toLocaleLowerCase()))])].map(value => ({ value }));
  return <><label className="field-label location-field"><span className="location-heading">{t("location", locale)}
    <i className={`location-status is-${status}`} role="status" aria-label={statusText} title={statusText} />
    <span className="location-tools">
      <button type="button" className="icon-button" disabled={disabled || state === "busy"} onClick={() => void run("gps")} aria-label={t("useDeviceLocation", locale)} title={zh ? "读取当前 GPS，填入首个附近地点并提供候选" : "Read current GPS, fill the first nearby place and offer alternatives"}><Icon name="map-pin" size={12} /></button>
      <button type="button" className="icon-button" disabled={disabled || state === "busy" || !value.trim() || !services.config || !geocodeConfigured(services.config)} onClick={() => void run("refresh")} aria-label={zh ? "按名称刷新经纬度" : "Refresh coordinates by name"} title={zh ? "按名称刷新经纬度（需要地图服务）" : "Refresh coordinates by name (requires map service)"}><Icon name="refresh" size={12} /></button>
      <button type="button" className="icon-button" disabled={disabled} onClick={() => { initialPoint.current = storedPoint; setPicking(true); }} aria-label={zh ? "地图选点" : "Pick on map"} title={zh ? "在地图上选取地点" : "Choose a point on the map"}><Icon name="map" size={12} /></button>
    </span></span><div className="location-input-wrap"><input ref={input} aria-label={t("location", locale)} disabled={disabled} value={value} onChange={event => { sequence.current += 1; setState("idle"); setMessage(""); onChange(event.target.value); setNearby([]); }} placeholder={t("locationPlaceholder", locale)} />
      {value && <button type="button" className="icon-button location-clear" disabled={disabled} aria-label={t("clearLocation", locale)} title={t("clearLocation", locale)} onClick={() => { sequence.current += 1; setState("idle"); setMessage(""); onChange(undefined); }}><Icon name="close" size={11} /></button>}
      <FieldSuggestions inputRef={input} locale={locale} suggestions={candidates} onSelect={name => { void choose(name); }} />
    </div><span className="visually-hidden" role="status">{message}</span>
  </label>
  {picking && <Suspense fallback={createPortal(<div className="place-picker-backdrop"><div className="panel place-picker-opening" role="status">{zh ? "正在打开地图…" : "Opening map…"}<button type="button" onClick={() => setPicking(false)}>{t("cancel", locale)}</button></div></div>, document.body)}><Picker locale={locale} initial={initialPoint.current} onClose={() => setPicking(false)} onSelect={point => {
    setPicking(false);
    const name = value.trim() || nearestPlaces(point, places, 0.1, 1)[0]?.place.address || `${zh ? "自选地点" : "Pinned place"} · ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
    void choose(name, point);
  }} /></Suspense>}
  </>;
}
