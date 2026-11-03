import { MapPlacePanel } from "./MapPlacePanel";
import { MapRouteLabels } from "./MapRouteLabels";
import { SolarSystem } from "./SolarSystem";
import type { FeatureCollection } from "geojson";
import { cssColor, localizedStyle, STYLE_URL } from "./mapStyle";
import { addStarfield } from "./mapStarfield";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, NavigationControl, type GeoJSONSource, type LayerSpecification, type StyleSpecification } from "maplibre-gl";
import "../styles/map.css";
import {
  ARC_TIERS, arcTier, clusterByAddress, entriesInRange, nearbyGeoClusters, GEO_TRIP_KM, greatCircleArc, hexToRgba, locateRecords, movementArcs, statsPresetRange,
  type ArcTier, type ChronoEonSettings, type Entry, type GeoCluster, type GeoPlace, type GeoPoint, type Item, type Locale, type StatsPresetKey, type StatsRange,
} from "@chronoeon/domain";
import { t, type MessageKey } from "../i18n";
import { usePersistentPreference } from "../hooks/usePersistentPreference";
import { GlassDatePicker } from "./GlassDateTimePicker";
import { Icon } from "./Icon";

const PointPicker = lazy(() => import("./MapPointPicker").then(module => ({ default: module.MapPointPicker })));
type RangeKey = "all" | StatsPresetKey;
const PRESETS: Array<{ key: RangeKey; label: MessageKey }> = [
  { key: "all", label: "rangeAll" }, { key: "7d", label: "range7d" }, { key: "1m", label: "range1m" }, { key: "3m", label: "range3m" },
  { key: "1y", label: "range1y" }, { key: "this_month", label: "rangeThisMonth" }, { key: "this_year", label: "rangeThisYear" },
];
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
/** Zoomed out this far the map reads as a globe; it turns slowly while nobody touches it. */
const GLOBE_SPIN_BELOW_ZOOM = 2.9;
const SPIN_IDLE_MS = 2600;
const SPIN_DEGREES_PER_SECOND = 2.4;

interface MapViewProps {
  entries: Entry[];
  items: Item[];
  places: Map<string, GeoPlace>;
  locale: Locale;
  settings: ChronoEonSettings;
  today: string;
  configured: boolean;
  geocodePending: number;
  onOpenEntry: (entry: Entry) => void;
  onOpenItem: (item: Item) => void;
  onOpenSettings: () => void;
  onExcludePlace?: (address: string) => void;
  onRetryPlace?: (address: string) => void;
  /** The user picked a new point for an address on the map. */
  onSetPlace?: (address: string, point: GeoPoint) => void;
}


function arrowImage(color: string): ImageData {
  const size = 22;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(size * 0.12, size * 0.18);
  context.lineTo(size * 0.92, size * 0.5);
  context.lineTo(size * 0.12, size * 0.82);
  context.lineTo(size * 0.34, size * 0.5);
  context.closePath();
  context.fill();
  return context.getImageData(0, 0, size, size);
}

function arcLabel(date: string, locale: Locale): string {
  const [, month, day] = date.split("-").map(Number);
  return locale === "zh" ? `${month}月${day}日` : `${month}/${day}`;
}

const TIER_WIDTH: Record<ArcTier, number> = { far: 2.3, mid: 1.9, near: 1.6, micro: 1.3 };

function addLayers(map: MapLibreMap) {
  const accent = cssColor("--accent", "#b9654b");
  const accentDark = cssColor("--accent-dark", "#98503b");
  const gold = cssColor("--gold", "#b88c4c");
  const ink = cssColor("--ink", "#272d26");
  map.addSource("places", { type: "geojson", data: EMPTY });
  map.addSource("arcs", { type: "geojson", data: EMPTY, lineMetrics: true });
  const hover = ["boolean", ["feature-state", "hover"], false];
  const scaled = (base: unknown) => ["*", base, ["case", hover, 1.45, 1]];
  const layers: unknown[] = [
    { id: "heat", type: "heatmap", source: "places", minzoom: 2.5, maxzoom: 16, paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "count"], 1, 0.3, 8, 0.65, 40, 1],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 8, 1, 13, 1.5],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 2, 14, 6, 24, 10, 36, 14, 52],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 2.5, 0.55, 5, 0.8, 9, 0.8, 13, 0.4, 16, 0.08],
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.12, hexToRgba(accent, 0.16), 0.4, hexToRgba(accent, 0.42),
        0.7, hexToRgba(accentDark, 0.7), 1, hexToRgba(accentDark, 0.95)],
    } },
    // Soft glows stand in for the heat layer on the globe, where a handful of
    // bright spots read better than a blurred field.
    { id: "place-glow", type: "circle", source: "places", maxzoom: 5.5, paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["+", 5, ["*", 9, ["get", "weight"]]], 5, ["+", 9, ["*", 15, ["get", "weight"]]]],
      "circle-color": accent, "circle-blur": 1, "circle-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.62, 5.5, 0.1],
    } },
  ];
  for (const band of ARC_TIERS) {
    const tierFilter = ["==", ["get", "tier"], band.tier];
    layers.push(
      { id: `arcs-${band.tier}-trip`, type: "line", source: "arcs", minzoom: band.minZoom, filter: ["all", tierFilter, ["==", ["get", "sameday"], 1]],
        layout: { "line-cap": "round", "line-join": "round" }, paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, TIER_WIDTH[band.tier] * 0.7, 10, TIER_WIDTH[band.tier] * 1.3], "line-opacity": 0.32,
          "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, hexToRgba(gold, 0.75), 0.55, accent, 1, accentDark],
        } },
      { id: `arcs-${band.tier}-move`, type: "line", source: "arcs", minzoom: band.minZoom, filter: ["all", tierFilter, ["==", ["get", "sameday"], 0]],
        layout: { "line-cap": "round", "line-join": "round" }, paint: {
          "line-color": accentDark, "line-dasharray": [2.2, 1.6], "line-opacity": 0.72,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, TIER_WIDTH[band.tier] * 0.6, 10, TIER_WIDTH[band.tier] * 1.1],
        } },
      { id: `arc-arrows-${band.tier}`, type: "symbol", source: "arcs", minzoom: band.minZoom, filter: tierFilter, layout: {
        "symbol-placement": "line", "symbol-spacing": 150, "icon-image": "travel-arrow", "icon-size": 0.4,
        "icon-rotation-alignment": "map", "icon-allow-overlap": false, "icon-ignore-placement": false,
      } },
      { id: `arc-dates-${band.tier}`, type: "symbol", source: "arcs", minzoom: band.minZoom + 1, filter: ["all", tierFilter, ["==", ["get", "transport"], 0]], layout: {
        "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-offset": [0, -0.9],
        "text-rotation-alignment": "viewport", "text-pitch-alignment": "viewport",
      }, paint: { "text-color": accentDark, "text-halo-color": "rgba(255,255,255,.95)", "text-halo-width": 1.4 } },
    );
  }
  layers.push(
    { id: "places", type: "circle", source: "places", minzoom: 4.5, paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, scaled(["+", 3, ["*", 3, ["get", "weight"]]]), 12, scaled(["+", 6, ["*", 9, ["get", "weight"]]])],
      "circle-color": ["case", ["==", ["get", "approximate"], 1], gold, accent],
      "circle-stroke-color": "#ffffff", "circle-stroke-width": ["case", hover, 2.4, 1.6],
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.55, 9, 0.95],
    } },
    { id: "place-labels", type: "symbol", source: "places", minzoom: 7.5, layout: {
      "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 12.5],
      "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true, "text-max-width": 10, "symbol-sort-key": ["-", 0, ["get", "count"]],
    }, paint: { "text-color": ink, "text-halo-color": "rgba(255,255,255,.92)", "text-halo-width": 1.4 } },
    { id: "selected", type: "circle", source: "places", filter: ["==", ["get", "address"], ""], paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 9, 12, 18], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": accentDark, "circle-stroke-width": 2.5,
    } },
  );
  map.addImage("travel-arrow", arrowImage(accentDark));
  for (const layer of layers) map.addLayer(layer as LayerSpecification);
}

export function MapView({ entries, items, places, locale, settings, today, configured, geocodePending, onOpenEntry, onOpenItem, onOpenSettings, onExcludePlace, onRetryPlace, onSetPlace }: MapViewProps) {
  const [preset, setPreset] = usePersistentPreference<RangeKey>("map-range", "all");
  const [customRange, setCustomRange] = usePersistentPreference<StatsRange | null>("map-custom-range", null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [sort, setSort] = useState<{ column: "name" | "count"; ascending: boolean }>({ column: "count", ascending: false });
  const [panelExpanded, setPanelExpanded] = useState(true);
  const [placesExpanded, setPlacesExpanded] = useState(true);
  const [groupAddresses, setGroupAddresses] = useState<string[]>([]);
  const [solar, setSolar] = useState(false);
  const [trails, setTrails] = useState(false);
  const [photosOnly, setPhotosOnly] = useState(false);
  const [ready, setReady] = useState(false);
  const [space, setSpace] = useState(false);
  const [picking, setPicking] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const lastInteraction = useRef(0);
  const hoverId = useRef<number | string | undefined>(undefined);
  const pickingRef = useRef(false);
  const zh = locale === "zh";

  const earliest = useMemo(() => {
    let min = today;
    for (const entry of entries) if (entry.location && entry.date < min) min = entry.date;
    for (const item of items) if (item.location && item.acquiredOn < min) min = item.acquiredOn;
    return min;
  }, [entries, items, today]);
  const range = useMemo<StatsRange>(() => customRange ?? (preset === "all" ? { start: earliest, end: today } : statsPresetRange(preset, today, settings.firstDay)),
    [customRange, preset, earliest, today, settings.firstDay]);
  const records = useMemo(() => locateRecords(entries, items, range, (address) => places.get(address)), [entries, items, range, places]);
  const clusters = useMemo(() => clusterByAddress(records), [records]);
  const transportEntries = useMemo(() => entriesInRange(entries, range), [entries, range]);
  const arcs = useMemo(() => movementArcs(records, transportEntries), [records, transportEntries]);
  const selected: GeoCluster | undefined = useMemo(() => clusters.find(cluster => cluster.address === selectedAddress), [clusters, selectedAddress]);
  const panelGroups = useMemo(() => selected ? [selected, ...clusters.filter(cluster => cluster !== selected && groupAddresses.includes(cluster.address))] : [], [selected, clusters, groupAddresses]);
  const visibleArcs = useMemo(() => arcs.filter(arc => trails || panelGroups.some(group => group.addresses.includes(arc.from.address) || group.addresses.includes(arc.to.address))), [arcs, trails, panelGroups]);
  const selectPlaceRef = useRef<(address: string, focus?: boolean) => void>(() => {});
  selectPlaceRef.current = (address, focus = false) => {
    const cluster = clusters.find(place => place.address === address), map = mapRef.current;
    if (!cluster) return;
    const neighbors = map && !focus ? nearbyGeoClusters(cluster, clusters, map.getZoom(), point => map.project([point.lng, point.lat])) : [cluster];
    setSelectedAddress(address); setGroupAddresses(neighbors.map(place => place.address)); setPanelExpanded(true);
    lastInteraction.current = Date.now();
    if (map && (focus || map.getZoom() < 2.3)) map.easeTo({center:[cluster.point.lng,cluster.point.lat],zoom:focus?Math.max(map.getZoom(),12):5.5,duration:650});
  };
  const trips = useMemo(() => arcs.filter((arc) => arc.sameDay && arc.km >= GEO_TRIP_KM).length, [arcs]);
  const placesData = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: clusters.map((cluster, index) => ({
      type: "Feature", id: index, geometry: { type: "Point", coordinates: [cluster.point.lng, cluster.point.lat] },
      properties: { address: cluster.address, label: cluster.address.length > 14 ? `${cluster.address.slice(0, 13)}…` : cluster.address, count: cluster.count,
        weight: Math.min(1, Math.log2(1 + cluster.count) / 6), photos: cluster.photos, approximate: cluster.precision === "approximate" ? 1 : 0 },
    })),
  }), [clusters]);
  const arcsData = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: visibleArcs.map((arc) => ({
      type: "Feature", geometry: { type: "LineString", coordinates: greatCircleArc(arc.from.point, arc.to.point) },
      properties: { id: arc.id, date: arc.date, label: arcLabel(arc.date, locale), km: Math.round(arc.km), tier: arcTier(arc.km), sameday: arc.sameDay ? 1 : 0, transport: arc.journeys.some(journey => journey.entry) ? 1 : 0 },
    })),
  }), [visibleArcs, locale]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let map: MapLibreMap | null = null;
    let frame = 0;
    void (async () => {
      let style: StyleSpecification | string = STYLE_URL;
      try {
        const response = await fetch(STYLE_URL);
        if (response.ok) style = localizedStyle(await response.json() as StyleSpecification, locale);
      } catch (error) { console.warn("Map style fallback", error); }
      if (disposed) return;
      const instance = new MapLibreMap({ container, style, center: [105, 35], zoom: 3.2, minZoom: 0.2, maxZoom: 18, attributionControl: { compact: true } });
      map = instance;
      const updateZoom = () => {
        const zoom = instance.getZoom(); setSpace(zoom < 3.5); setSolar(zoom < 2.3);
        container.parentElement?.style.setProperty("--solar-opacity", String(Math.max(0, Math.min(1, (2.3-zoom)/.65))));
      };
      instance.on("zoom", updateZoom); updateZoom();
      instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
      const touched = () => { lastInteraction.current = Date.now(); };
      for (const event of ["mousedown", "touchstart", "wheel", "dragstart", "zoomstart", "rotatestart", "pitchstart"] as const) instance.on(event, touched);
      instance.on("load", () => {
        if (disposed) return;
        try { instance.setProjection({ type: "globe" }); } catch (error) { console.warn("Globe projection unavailable", error); }
        addStarfield(instance);
        addLayers(instance);
        instance.on("click", "places", (event) => {
          if (pickingRef.current) return;
          const address = event.features?.[0]?.properties?.address;
          if (typeof address === "string" && instance.getZoom() >= 2.3) selectPlaceRef.current(address);
        });
        instance.on("click", "place-glow", event => {
          if (instance.getZoom() >= 2.3 && instance.getZoom() < 4.5) { const address = event.features?.[0]?.properties?.address; if (typeof address === "string") selectPlaceRef.current(address); }
        });
        instance.on("click", (event) => {
          if (instance.getZoom() >= 2.3 && !instance.queryRenderedFeatures(event.point, { layers: ["places", "place-glow"] }).length) setSelectedAddress(null);
        });
        instance.on("mousemove", "places", (event) => {
          const id = event.features?.[0]?.id;
          if (hoverId.current !== undefined && hoverId.current !== id) instance.setFeatureState({ source: "places", id: hoverId.current }, { hover: false });
          if (id !== undefined) { instance.setFeatureState({ source: "places", id }, { hover: true }); hoverId.current = id; }
          instance.getCanvas().style.cursor = pickingRef.current ? "crosshair" : "pointer";
        });
        instance.on("mouseleave", "places", () => {
          if (hoverId.current !== undefined) instance.setFeatureState({ source: "places", id: hoverId.current }, { hover: false });
          hoverId.current = undefined;
          instance.getCanvas().style.cursor = pickingRef.current ? "crosshair" : "";
        });
        setReady(true);
        // The globe turns on its own only while it is a globe and idle.
        let lastTick = performance.now();
        const spin = (now: number) => {
          if (disposed) return;
          const seconds = Math.min(0.25, Math.max(0, now - lastTick) / 1000);
          lastTick = now;
          if (!document.hidden && instance.getZoom() >= 2.3 && instance.getZoom() < GLOBE_SPIN_BELOW_ZOOM && !instance.isMoving() && !pickingRef.current && Date.now() - lastInteraction.current > SPIN_IDLE_MS) {
            const center = instance.getCenter();
            instance.jumpTo({ center: [center.lng + SPIN_DEGREES_PER_SECOND * seconds, center.lat] });
          }
          frame = requestAnimationFrame(spin);
        };
        frame = requestAnimationFrame(spin);
      });
      mapRef.current = instance;
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      setReady(false);
      mapRef.current = null;
      map?.remove();
    };
  }, [locale]);

  // Incremental: only the GeoJSON sources change; the basemap stays put.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("places") as GeoJSONSource | undefined)?.setData(placesData);
    (map.getSource("arcs") as GeoJSONSource | undefined)?.setData(arcsData);
  }, [ready, placesData, arcsData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("selected", ["==", ["get", "address"], selectedAddress ?? ""]);
  }, [ready, selectedAddress]);

  useEffect(() => {
    pickingRef.current = picking;
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = picking ? "crosshair" : "";

  }, [picking]);

  const rangeKey = `${range.start}/${range.end}`;
  const clustersRef = useRef(clusters);
  clustersRef.current = clusters;
  const fittedRef = useRef<string>("");
  useEffect(() => {
    const map = mapRef.current;
    const current = clustersRef.current;
    if (!map || !ready || !current.length || fittedRef.current === rangeKey) return;
    fittedRef.current = rangeKey;
    const bounds = new LngLatBounds();
    for (const cluster of current) bounds.extend([cluster.point.lng, cluster.point.lat]);
    lastInteraction.current = Date.now();
    map.fitBounds(bounds, { padding: { top: 90, bottom: 60, left: 60, right: selected ? 380 : 60 }, maxZoom: 13, duration: 900 });
  }, [ready, rangeKey, clusters.length, selected]);

  const selectPreset = (key: RangeKey) => { setCustomRange(null); setPreset(key); };
  const selectCustomDate = (value: string | undefined, edge: "start" | "end") => {
    setCustomRange(edge === "start" ? { start: value || range.end, end: range.end } : { start: range.start, end: value || range.start });
  };
  const startPicking = () => {
    if (!selected) return;
    setPicking(true);
  };
  const forEachAddress = (action?: (address: string) => void) => { if (selected) for (const address of selected.addresses) action?.(address); };
  const showSetup = !configured && places.size === 0;

  return (
    <section className="map-page">
      <header className="page-title-row view-title-row map-title-row">
        <div>
          <h2 className="view-heading"><span className="headline-leaf">{t("mapTitle", locale)}</span></h2>
        </div>
        <div className="stats-custom-range">
          <label>
            <span className="visually-hidden">{t("date", locale)}</span>
            <GlassDatePicker value={range.start} max={range.end} ariaLabel={t("date", locale)} placeholder={t("dateAny", locale)} locale={locale} clearable={false} onChange={(value) => selectCustomDate(value, "start")} />
          </label>
          <span aria-hidden="true">→</span>
          <label>
            <span className="visually-hidden">{t("endDate", locale)}</span>
            <GlassDatePicker value={range.end} min={range.start} ariaLabel={t("endDate", locale)} placeholder={t("dateAny", locale)} locale={locale} clearable={false} onChange={(value) => selectCustomDate(value, "end")} />
          </label>
        </div>
      </header>
      <div className="stats-range map-range" role="group" aria-label={t("statsPeriod", locale)}>
        <button type="button" aria-pressed={trails} onClick={() => setTrails(value => !value)}>{zh ? "轨迹" : "Trails"} {trails ? "●" : "○"}</button>
        {PRESETS.map((item) => (
          <button key={item.key} type="button" aria-pressed={!customRange && preset === item.key} className={!customRange && preset === item.key ? "is-active" : ""} onClick={() => selectPreset(item.key)}>
            {t(item.label, locale)}
          </button>
        ))}
      </div>

      <div className={`map-stage panel${selected ? " has-panel" : ""}${picking ? " is-picking" : ""}${space ? " is-space" : ""}${solar ? " is-solar" : ""}`} data-swipe-ignore>
        <div ref={containerRef} className="map-canvas" aria-label={t("mapTitle", locale)} />
        {solar && <SolarSystem locale={locale} onEarth={() => mapRef.current?.easeTo({zoom:3.7,duration:850})} />}
        {ready && mapRef.current && <MapRouteLabels map={mapRef.current} arcs={visibleArcs} locale={locale} onOpenEntry={onOpenEntry} />}
        <p className="map-summary" role="status">
            <span><Icon name="map-pin" size={12} /><b>{clusters.length}</b>{t("mapPlacesLabel", locale)}</span>
            <span><Icon name="agenda" size={12} /><b>{records.length}</b>{t("mapRecordsLabel", locale)}</span>
            {trips > 0 && <span><i className="map-chip-line is-trip" aria-hidden="true" /><b>{trips}</b>{t("mapTripsLabel", locale)}</span>}
            {arcs.length - trips > 0 && <span><i className="map-chip-line is-move" aria-hidden="true" /><b>{arcs.length - trips}</b>{t("mapMovesLabel", locale)}</span>}
            {geocodePending > 0 && <span className="map-pending"><i aria-hidden="true" />{t("mapLocating", locale).replace("{count}", String(geocodePending))}</span>}
          </p>
        {clusters.length > 0 && !selected && <div className={`map-hud map-place-index${placesExpanded ? "" : " is-collapsed"}`}>
          <button type="button" className="map-index-toggle" aria-expanded={placesExpanded} onClick={() => setPlacesExpanded(value => !value)}><Icon name="map-pin" size={13}/><strong>{zh ? "地点" : "Places"}</strong><span>{clusters.length}</span><Icon name={placesExpanded ? "chevron-up" : "chevron-down"} size={12}/></button>
          {placesExpanded && <><div className="map-sort-head">{(["name", "count"] as const).map(column => <button type="button" key={column} onClick={() => setSort(current => ({column,ascending:current.column===column?!current.ascending:column==="name"}))}>{column==="name"?(zh?"名称":"Name"):(zh?"数量":"Count")}{sort.column===column?(sort.ascending?" ↑":" ↓"):" ↕"}</button>)}</div>
          <ol className="map-top-places" aria-label={t("mapPlaces",locale).replace("{count}",String(clusters.length))}>
            {[...clusters].sort((a,b)=>(sort.column==="count"?a.count-b.count:a.address.localeCompare(b.address,locale))*(sort.ascending?1:-1)).map(cluster=><li key={cluster.address}><button type="button" onClick={()=>selectPlaceRef.current(cluster.address)} title={cluster.address}><i className={cluster.precision==="approximate"?"is-approximate":""}/><span>{cluster.address}</span><b>{cluster.count}</b></button></li>)}
          </ol></>}
        </div>}
        {picking && selected && <Suspense fallback={null}><PointPicker locale={locale} initial={selected.point} onClose={() => setPicking(false)} onSelect={point => { for (const address of selected.addresses) onSetPlace?.(address, point); setPicking(false); }} /></Suspense>}
        {showSetup && (
          <div className="map-overlay-card">
            <Icon name="map-pin" size={22} />
            <p>{t("mapSetupHint", locale)}</p>
            <button type="button" className="primary-action" onClick={onOpenSettings}>{t("mapOpenSettings", locale)}<Icon name="arrow-right" size={14} /></button>
          </div>
        )}
        {!showSetup && ready && !records.length && (
          <div className="map-overlay-card is-quiet">
            <p>{geocodePending > 0 ? t("mapLocating", locale).replace("{count}", String(geocodePending)) : t("mapEmpty", locale)}</p>
          </div>
        )}
        {selected && <MapPlacePanel selected={selected} groups={panelGroups} locale={locale} settings={settings} expanded={panelExpanded} photosOnly={photosOnly} onExpanded={setPanelExpanded} onPhotosOnly={setPhotosOnly} onClose={() => setSelectedAddress(null)} onFocus={cluster => selectPlaceRef.current(cluster.address,true)} onOpenEntry={onOpenEntry} onOpenItem={onOpenItem}
          onPick={onSetPlace ? startPicking : undefined}
          onRetry={onRetryPlace ? () => { forEachAddress(onRetryPlace); setSelectedAddress(null); } : undefined}
          onExclude={onExcludePlace ? () => { forEachAddress(onExcludePlace); setSelectedAddress(null); } : undefined} />}
        <p className="map-legend" aria-hidden="true">
          <span><i className="is-precise" />{zh ? "精确" : "precise"}</span>
          <span><i className="is-approximate" />{zh ? "近似" : "approx."}</span>
          {(trails || selected) && <span><i className="is-arc" />{zh ? "短时位移 / 交通" : "short moves / transport"}</span>}
        </p>
      </div>
    </section>
  );
}
