import { useFocusTrap, useModalDismiss } from "./modalLayer";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Map as MapLibreMap, Marker, NavigationControl, type StyleSpecification } from "maplibre-gl";
import { nearestPlaces, type GeoPoint, type Locale } from "@chronoeon/domain";
import { localizedStyle, STYLE_URL } from "./mapStyle";
import { usePlaceServices } from "./PlaceServices";
import { requestCoordinates } from "../platform/location";

export function MapPointPicker({ locale, initial, onSelect, onClose }: { locale: Locale; initial?: GeoPoint; onSelect: (point: GeoPoint) => void; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useFocusTrap(dialog);
  useModalDismiss(event => { event.preventDefault(); onClose(); });
  const { places } = usePlaceServices();
  const [point, setPoint] = useState<GeoPoint | undefined>(initial);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const zh = locale === "zh";
  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(STYLE_URL, { signal: controller.signal });
        if (!response.ok) throw new Error("Map unavailable");
        const style = localizedStyle(await response.json() as StyleSpecification, locale);
        if (disposed || !container.current) return;
        const center = initial ?? [...places.values()][0] ?? { lng: 105, lat: 35 };
        const instance = new MapLibreMap({ container: container.current, style, center: [center.lng, center.lat], zoom: initial || places.size ? 16 : 4, attributionControl: { compact: true } });
        map = instance;
        instance.once("load", () => { if (!disposed) setLoading(false); });
        instance.addControl(new NavigationControl());
        for (const place of places.values()) if ((place.score ?? 0) >= 70) new Marker({ color: "#869b92", scale: 0.55 }).setLngLat([place.lng, place.lat]).addTo(instance);
        let interacted = false;
        instance.on("mousedown", () => { interacted = true; });
        instance.on("touchstart", () => { interacted = true; });
        instance.on("wheel", () => { interacted = true; });
        if (!initial) void requestCoordinates().then(fix => {
          if (fix && !disposed && !interacted) instance.easeTo({ center: [fix.longitude, fix.latitude], zoom: 16, duration: 450 });
        });
        const marker = new Marker({ color: "#b9654b" });
        if (initial) marker.setLngLat([initial.lng, initial.lat]).addTo(instance);
        instance.on("click", event => {
          const raw = { lng: event.lngLat.wrap().lng, lat: event.lngLat.lat };
          // Snap only inside a small on-screen radius, so nearby rooms remain selectable.
          const hit = nearestPlaces(raw, places.values(), 0.1, 1)[0]?.place;
          const projected = hit ? instance.project([hit.lng, hit.lat]) : null;
          const next = hit && projected && Math.hypot(projected.x - event.point.x, projected.y - event.point.y) <= 18 ? { lng: hit.lng, lat: hit.lat } : raw;
          marker.setLngLat([next.lng, next.lat]).addTo(instance);
          setPoint(next);
        });
      } catch { if (!disposed) { setError(true); setLoading(false); } }
    })();
    return () => { disposed = true; controller.abort(); map?.remove(); };
  }, [locale, initial, places]);

  return createPortal(<div className="place-picker-backdrop" onClick={onClose}><section ref={dialog} className="place-picker panel" role="dialog" aria-modal="true" aria-label={zh ? "地图选点" : "Pick a place"} onClick={event => event.stopPropagation()}>
    <header><strong>{zh ? "地图选点 · 点击地图，吸附附近地点" : "Click the map · snaps to nearby places"}</strong><button type="button" onClick={onClose}>{zh ? "取消" : "Cancel"}</button></header>
    <div ref={container} className="place-picker-map" />
    <footer role="status">{error ? (zh ? "地图加载失败，请检查网络" : "Map unavailable. Check your connection.") : loading ? (zh ? "正在加载地图…" : "Loading map…") : point ? `${point.lng.toFixed(6)}, ${point.lat.toFixed(6)} · WGS84` : (zh ? "请选择一个位置" : "Choose a location")}<button className="primary-action" type="button" disabled={!point} onClick={() => { if (point) onSelect(point); }}>{zh ? "使用此位置" : "Use this point"}</button></footer>
  </section></div>, document.body);
}
