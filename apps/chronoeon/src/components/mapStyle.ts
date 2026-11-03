import { setWorkerUrl, type LayerSpecification, type StyleSpecification } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { FeatureCollection } from "geojson";
import { hexToRgba, type Locale } from "@chronoeon/domain";
import "maplibre-gl/dist/maplibre-gl.css";
// Bundler URL works in both Vite and the packaged WebView.
setWorkerUrl(mapWorkerUrl);

/** Keyless vector basemap with CJK glyphs; the style is patched for the UI language. */
export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** A wash over the whole basemap, drawn under its labels. */
const WORLD: FeatureCollection = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } }] };
/** The Chinese name alone: OSM often stores "简体;繁體" or "简体 / 繁體" in one field, so keep what precedes the separator. */
const CHINESE_NAME: unknown = ["coalesce", ["get", "name:zh"], ["get", "name:nonlatin"], ["get", "name:latin"], ["get", "name"], ""];
const CHINESE_LABEL: unknown = ["let", "name", CHINESE_NAME, ["case",
  [">=", ["index-of", ";", ["var", "name"]], 0], ["slice", ["var", "name"], 0, ["index-of", ";", ["var", "name"]]],
  [">=", ["index-of", " / ", ["var", "name"]], 0], ["slice", ["var", "name"], 0, ["index-of", " / ", ["var", "name"]]],
  ["var", "name"]]];

export function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/**
 * Labels in the interface language only — Chinese names in the Chinese UI,
 * Latin names in English — plus a paper wash under the labels that lifts the
 * basemap toward the app's own surfaces, and the globe projection.
 */
export function localizedStyle(style: StyleSpecification, locale: Locale): StyleSpecification {
  for (const layer of style.layers) {
    const layout = (layer as { layout?: Record<string, unknown> }).layout;
    if (!layout) continue;
    const text = JSON.stringify(layout["text-field"] ?? "");
    if (!text.includes("name:latin") && !text.includes("name:nonlatin")) continue;
    layout["text-field"] = locale === "zh" ? CHINESE_LABEL : ["coalesce", ["get", "name:latin"], ["get", "name_en"], ["get", "name"]];
  }
  const firstSymbol = style.layers.findIndex((layer) => layer.type === "symbol");
  style.sources = { ...style.sources, "paper-wash": { type: "geojson", data: WORLD } };
  style.layers.splice(firstSymbol < 0 ? style.layers.length : firstSymbol, 0, {
    id: "paper-wash", type: "fill", source: "paper-wash", paint: { "fill-color": hexToRgba(cssColor("--paper", "#f7f3ec"), 0.42) },
  } as LayerSpecification);
  style.sky = { "sky-color": "#080f22", "horizon-color": "#667f9a", "sky-horizon-blend": 0.12, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 1, 0.7, 4, 0] };
  style.projection = { type: "globe" };
  return style;
}
