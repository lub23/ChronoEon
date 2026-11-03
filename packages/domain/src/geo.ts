import type { Entry } from "./entry";
import type { Item } from "./item";
import { entriesInRange, type StatsRange } from "./stats";

/** WGS84 coordinates; every provider's answer is converted before it is stored. */
export interface GeoPoint { lng: number; lat: number }

export interface GeoPlace extends GeoPoint {
  address: string;
  score: number | null;
  level: string | null;
}

/** The cache key for one stored location string. */
export function normalizeAddress(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * How far a geocoder hit can be trusted. apihz grades exact POIs 70+ while a
 * district-level fallback sits around 50–66; anything lower is usually a wrong
 * province, and a negative score marks an address the user excluded.
 */
export type GeoPrecision = "precise" | "approximate";
export const GEO_PRECISE_SCORE = 70;
export const GEO_MIN_SCORE = 50;
export function geoPrecision(score: number | null): GeoPrecision | null {
  if (score === null || score < GEO_MIN_SCORE) return null;
  return score >= GEO_PRECISE_SCORE ? "precise" : "approximate";
}

/** Forward-geocoding services the app can call with the user's own key. */
export type GeocodeProvider = "apihz" | "amap";
export const GEOCODE_PROVIDERS: GeocodeProvider[] = ["apihz", "amap"];
export const GEOCODE_ENDPOINTS: Record<GeocodeProvider, string> = {
  apihz: "https://cn.apihz.cn/api/other/jwjuhe.php",
  amap: "https://restapi.amap.com/v3/geocode/geo",
};
/** Level names that mean the user typed the coordinates themselves. */
export const GEO_LEVEL_MANUAL = "manual";
export const GEO_LEVEL_DEVICE = "gps";

/** Amap grades a hit by the kind of feature it matched; map that onto the apihz 0–100 scale. */
const AMAP_LEVEL_SCORES: Record<string, number> = {
  门牌号: 100, 兴趣点: 90, 住宅区: 85, 写字楼: 85, 地铁站: 85, 公交站: 80, 热点商圈: 80,
  道路交叉路口: 75, 道路: 75, 村庄: 70, 乡镇: 65, 开发区: 62, 区县: 60, 市: 55, 省: 50, 国家: 50,
};
export function amapLevelScore(level: string | null | undefined): number {
  if (!level) return 70;
  return AMAP_LEVEL_SCORES[level] ?? 70;
}

// GCJ-02 → WGS84: the published offset formula run backwards once. It lands
// within a couple of metres, far inside any marker on the map.
const GCJ_A = 6378245;
const GCJ_EE = 0.00669342162296594323;
function gcjTransformLat(x: number, y: number): number {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  ret += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return ret;
}
function gcjTransformLng(x: number, y: number): number {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  ret += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return ret;
}
export function gcj02ToWgs84(point: GeoPoint): GeoPoint {
  const { lng, lat } = point;
  // Outside mainland China the offset is never applied, so there is nothing to undo.
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return point;
  let dLat = gcjTransformLat(lng - 105, lat - 35);
  let dLng = gcjTransformLng(lng - 105, lat - 35);
  const radLat = lat / 180 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lng: lng - dLng, lat: lat - dLat };
}

/** Forward offset, used only when a provider requires GCJ-02 input. */
export function wgs84ToGcj02(point: GeoPoint): GeoPoint {
  const inverse = gcj02ToWgs84(point);
  return { lng: 2 * point.lng - inverse.lng, lat: 2 * point.lat - inverse.lat };
}

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => degrees * Math.PI / 180;
const toDegrees = (radians: number) => radians * 180 / Math.PI;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cached places close enough to a device fix to be the same spot, nearest first. */
export const GEO_NEARBY_KM = 0.25;
export function nearestPlaces(point: GeoPoint, places: Iterable<GeoPlace>, maxKm = GEO_NEARBY_KM, limit = 5): Array<{ place: GeoPlace; km: number }> {
  const result: Array<{ place: GeoPlace; km: number }> = [];
  for (const place of places) {
    if ((place.score ?? 0) < GEO_PRECISE_SCORE) continue;
    const km = haversineKm(point, place);
    if (km <= maxKm) result.push({ place, km });
  }
  return result.sort((left, right) => left.km - right.km).slice(0, limit);
}

/**
 * Points along a great circle, bowed slightly off the direct path so an arc
 * reads as travel rather than as a border. Returned as [lng, lat] pairs.
 */
export function greatCircleArc(a: GeoPoint, b: GeoPoint, steps = 48): Array<[number, number]> {
  const φ1 = toRadians(a.lat), λ1 = toRadians(a.lng), φ2 = toRadians(b.lat), λ2 = toRadians(b.lng);
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2)));
  if (d === 0) return [[a.lng, a.lat], [b.lng, b.lat]];
  const points: Array<[number, number]> = [];
  for (let index = 0; index <= steps; index += 1) {
    const f = index / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    const lat = toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y)));
    const lng = toDegrees(Math.atan2(y, x));
    // Lift the middle of the arc perpendicular to the chord: a shallow bow that
    // keeps both ends anchored on their places.
    const bow = Math.sin(f * Math.PI) * Math.min(6, toDegrees(d) * 0.18);
    const heading = Math.atan2(b.lng - a.lng, b.lat - a.lat);
    points.push([lng - bow * Math.cos(heading) * 0.5, lat + bow * Math.sin(heading) * 0.5]);
  }
  return points;
}

export interface LocatedRecord {
  id: string;
  kind: "entry" | "item";
  address: string;
  date: string;
  start?: string;
  title: string;
  images: string[];
  point: GeoPoint;
  precision: GeoPrecision;
  entry?: Entry;
  item?: Item;
}

/**
 * Join the user's records with the geocode cache. Recurring entries are
 * expanded into their occurrences inside the range; records whose address has
 * no trustworthy coordinates are left out rather than drawn in the wrong place.
 */
export function locateRecords(
  entries: readonly Entry[],
  items: readonly Item[],
  range: StatsRange,
  lookup: (address: string) => GeoPlace | undefined,
): LocatedRecord[] {
  const records: LocatedRecord[] = [];
  const locate = (address: string | undefined) => {
    if (!address?.trim()) return undefined;
    const place = lookup(normalizeAddress(address));
    const precision = place ? geoPrecision(place.score) : null;
    return place && precision ? { place, precision } : undefined;
  };
  for (const entry of entriesInRange(entries as Entry[], range)) {
    const located = locate(entry.location);
    if (!located) continue;
    records.push({ id: `${entry.id}:${entry.occurrenceDate ?? entry.date}`, kind: "entry", address: located.place.address, date: entry.date, start: entry.start,
      title: entry.title, images: entry.images ?? [], point: { lng: located.place.lng, lat: located.place.lat }, precision: located.precision, entry });
  }
  for (const item of items) {
    if (item.acquiredOn < range.start || item.acquiredOn > range.end) continue;
    const located = locate(item.location);
    if (!located) continue;
    records.push({ id: `item:${item.id}`, kind: "item", address: located.place.address, date: item.acquiredOn, start: item.acquiredAt,
      title: item.name, images: item.images ?? [], point: { lng: located.place.lng, lat: located.place.lat }, precision: located.precision, item });
  }
  return records.sort((left, right) => left.date.localeCompare(right.date) || (left.start ?? "").localeCompare(right.start ?? ""));
}

export interface GeoCluster {
  /** The most used spelling of the place; `addresses` lists every spelling at this point. */
  address: string;
  addresses: string[];
  point: GeoPoint;
  count: number;
  photos: number;
  precision: GeoPrecision;
  records: LocatedRecord[];
  /** Earliest and latest visit, for the place card. */
  first: string;
  last: string;
}

/**
 * One marker per point, most visited first. Addresses that resolve to the same
 * coordinates — a building and its room numbers, two spellings of one shop —
 * share a marker and are named by their most used spelling.
 */
export function clusterByAddress(records: readonly LocatedRecord[]): GeoCluster[] {
  const clusters = new Map<string, GeoCluster & { tally: Map<string, number> }>();
  for (const record of records) {
    const key = `${record.point.lng.toFixed(5)},${record.point.lat.toFixed(5)}`;
    const cluster = clusters.get(key);
    if (cluster) {
      cluster.count += 1;
      cluster.photos += record.images.length;
      cluster.records.push(record);
      cluster.tally.set(record.address, (cluster.tally.get(record.address) ?? 0) + 1);
      if (record.date < cluster.first) cluster.first = record.date;
      if (record.date > cluster.last) cluster.last = record.date;
      if (record.precision === "precise") cluster.precision = "precise";
      continue;
    }
    clusters.set(key, { address: record.address, addresses: [record.address], point: record.point, count: 1, photos: record.images.length,
      precision: record.precision, records: [record], first: record.date, last: record.date, tally: new Map([[record.address, 1]]) });
  }
  return [...clusters.values()].map(({ tally, ...cluster }) => {
    const addresses = [...tally.entries()].sort((left, right) => right[1] - left[1] || left[0].length - right[0].length || left[0].localeCompare(right[0])).map(([address]) => address);
    return { ...cluster, address: addresses[0], addresses };
  }).sort((left, right) => right.count - left.count || left.address.localeCompare(right.address));
}

export type TransportMode = "flight" | "rail" | "metro" | "car" | "bus" | "walk" | "bike" | "boat" | "trip";
export interface GeoStop { address: string; point: GeoPoint }
export interface TravelJourney {
  id: string;
  date: string;
  start?: string;
  title: string;
  mode?: TransportMode;
  entry?: Entry;
  from: GeoStop;
  to: GeoStop;
  sameDay: boolean;
}
export interface TravelArc {
  id: string;
  date: string;
  from: GeoStop;
  to: GeoStop;
  km: number;
  sameDay: boolean;
  /** Explicit transport records first, newest first; otherwise observed moves. */
  journeys: TravelJourney[];
}
export const GEO_TRIP_KM = 60;

/** Titles are evidence of travel, not evidence of a route on their own. */
export function transportMode(title: string): TransportMode | undefined {
  if (/飞书|买车|购车|修车|洗车|停车|车险|车模|汽车保养|汽车展|飞机模型|回顾|回忆|回收|车厘子|walkthrough|flight simulator/i.test(title)) return undefined;
  if (/飞机|航班|乘机|机场|起飞|飞往|飞回|飞到|飞去|^飞|\b(flight|fly|flying|airport)\b/i.test(title)) return "flight";
  if (/地铁|轻轨|\b(metro|subway|underground)\b/i.test(title)) return "metro";
  if (/高铁|动车|火车|列车|\b(train|railway|rail)\b/i.test(title)) return "rail";
  if (/公交|大巴|巴士|班车|客车|\bbus\b/i.test(title)) return "bus";
  if (/走路|步行|徒步|走回|走去|\b(walk|walking|hike|hiking)\b/i.test(title)) return "walk";
  if (/骑行|骑车|自行车|单车|\b(bike|bicycle|cycling|cycle)\b/i.test(title)) return "bike";
  if (/轮船|渡轮|坐船|乘船|\b(ferry|boat|cruise)\b/i.test(title)) return "boat";
  if (/打车|坐车|乘车|开车|驾车|自驾|汽车|出租|网约车|滴滴|车回|车去|车到|\b(taxi|uber|drive|driving|car)\b/i.test(title)) return "car";
  if (/(出差|回家|返回|business trip|return).*(早餐|午餐|晚餐|早饭|午饭|晚饭|吃饭|咖啡|报销|回顾|整理|计划)/i.test(title)) return undefined;
  if (/出差|返程|返回|回家|回校|回京|^回(?!顾|忆|收|访|复)|\b(return|returning|commute|business trip)\b/i.test(title)) return "trip";
  return undefined;
}

function geoMoment(date: string, clock?: string): number | null {
  if (!clock || !/^\d{2}:\d{2}$/.test(clock)) return null;
  const hours = Number(clock.slice(0, 2)), minutes = Number(clock.slice(3));
  const day = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(day) && hours < 24 && minutes < 60 ? day / 60000 + hours * 60 + minutes : null;
}

/** Short observed moves, or a longer move supported by an explicit transport record.
 * No locations are invented. An undated-time transport is attached only to a unique
 * eligible route that day; ambiguous records remain ordinary records. */
export function movementArcs(records: readonly LocatedRecord[], entries: readonly Entry[] = []): TravelArc[] {
  const ordered = [...records].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? "") || a.id.localeCompare(b.id));
  const pairs: Array<{ from: LocatedRecord; to: LocatedRecord; begin: number; end: number; km: number; transport: Entry[] }> = [];
  const byDay = new Map<string, number[]>();
  for (let index = 1; index < ordered.length; index++) {
    const from = ordered[index - 1], to = ordered[index];
    const begin = geoMoment(from.date, from.start), end = geoMoment(to.date, to.start);
    const km = haversineKm(from.point, to.point);
    if (begin === null || end === null || end <= begin || end - begin > 72 * 60 || km < .08 || from.precision !== "precise" || to.precision !== "precise") continue;
    const pairIndex = pairs.length;
    pairs.push({ from, to, begin, end, km, transport: [] });
    for (let day = Math.floor(begin / 1440); day <= Math.floor(end / 1440); day++) {
      const key = new Date(day * 86400000).toISOString().slice(0, 10);
      const bucket = byDay.get(key) ?? []; bucket.push(pairIndex); byDay.set(key, bucket);
    }
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    const mode = transportMode(entry.title);
    const id = `${entry.id}:${entry.occurrenceDate ?? entry.date}`;
    if (!mode || entry.status === "cancelled" || seen.has(id)) continue;
    seen.add(id);
    const minimumKm = mode === "trip" && /出差|business trip/i.test(entry.title) ? 10 : .08;
    const moment = geoMoment(entry.date, entry.start);
    let pair: typeof pairs[number] | undefined;
    if (moment !== null) {
      let low = 0, high = pairs.length;
      while (low < high) { const mid = (low + high) >>> 1; if (pairs[mid].begin <= moment) low = mid + 1; else high = mid; }
      const candidate = pairs[low - 1];
      if (candidate && moment < candidate.end) pair = candidate;
    } else {
      const candidates = (byDay.get(entry.date) ?? []).map(index => pairs[index]).filter(candidate => candidate.km >= minimumKm);
      if (candidates.length === 1) pair = candidates[0];
    }
    if (pair && pair.km >= minimumKm) pair.transport.push(entry);
  }
  const groups = new Map<string, TravelArc>();
  for (const pair of pairs) {
    const { from, to, begin, end, km, transport } = pair;
    if (!transport.length && (from.date !== to.date || end - begin > 120)) continue;
    const stopFrom = { address: from.address, point: from.point }, stopTo = { address: to.address, point: to.point };
    const id = [from.point, to.point].map(point => `${point.lng.toFixed(5)},${point.lat.toFixed(5)}`).sort().join("|");
    const journeys: TravelJourney[] = transport.length ? transport.map(entry => ({ id: `${entry.id}:${entry.occurrenceDate ?? entry.date}`, date: entry.date, start: entry.start, title: entry.title, mode: transportMode(entry.title), entry, from: stopFrom, to: stopTo, sameDay: from.date === to.date }))
      : [{ id: `${from.id}>${to.id}`, date: to.date, start: to.start, title: "", from: stopFrom, to: stopTo, sameDay: from.date === to.date }];
    const previous = groups.get(id);
    if (previous) previous.journeys.push(...journeys);
    else groups.set(id, { id, date: to.date, from: stopFrom, to: stopTo, km, sameDay: from.date === to.date, journeys });
  }
  for (const arc of groups.values()) {
    arc.journeys.sort((a, b) => Number(Boolean(b.entry)) - Number(Boolean(a.entry)) || b.date.localeCompare(a.date) || (b.start ?? "").localeCompare(a.start ?? "") || b.id.localeCompare(a.id));
    const latest = arc.journeys[0];
    arc.date = latest.date; arc.from = latest.from; arc.to = latest.to;
    arc.sameDay = latest.sameDay;
  }
  return [...groups.values()];
}

/** A bounded neighborhood for a far-view selection; the selected place leads. */
export function nearbyGeoClusters(selected: GeoCluster, clusters: readonly GeoCluster[], zoom: number, screen: (point: GeoPoint) => { x: number; y: number }): GeoCluster[] {
  if (zoom >= 10) return [selected];
  const center = screen(selected.point), maxKm = zoom < 5 ? 300 : zoom < 8 ? 50 : 10;
  return [selected, ...clusters.filter(cluster => cluster !== selected && haversineKm(selected.point, cluster.point) <= maxKm)
    .map(cluster => ({ cluster, point: screen(cluster.point) }))
    .filter(({ point }) => Math.hypot(point.x - center.x, point.y - center.y) <= 72)
    .sort((a, b) => haversineKm(selected.point, a.cluster.point) - haversineKm(selected.point, b.cluster.point)).slice(0, 5).map(hit => hit.cluster)];
}

/** Which zoom band an arc belongs to: long hops read at country scale, short ones only up close. */
export type ArcTier = "far" | "mid" | "near" | "micro";
export const ARC_TIERS: Array<{ tier: ArcTier; minKm: number; minZoom: number }> = [
  { tier: "far", minKm: GEO_TRIP_KM, minZoom: 0 },
  { tier: "mid", minKm: 10, minZoom: 6 },
  { tier: "near", minKm: 1.5, minZoom: 9.5 },
  { tier: "micro", minKm: 0, minZoom: 12.5 },
];
export function arcTier(km: number): ArcTier {
  return ARC_TIERS.find((band) => km >= band.minKm)?.tier ?? "micro";
}
