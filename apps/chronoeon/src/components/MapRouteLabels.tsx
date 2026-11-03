import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Marker, type Map as MapLibreMap } from "maplibre-gl";
import { ARC_TIERS, arcTier, greatCircleArc, type Entry, type Locale, type TransportMode, type TravelArc } from "@chronoeon/domain";
import { Icon, type IconName } from "./Icon";
import { useFocusTrap, useModalDismiss } from "./modalLayer";

const icons: Record<TransportMode, IconName> = {flight:"plane",rail:"train",metro:"train",car:"car",bus:"car",walk:"walk",bike:"bike",boat:"ship",trip:"map-pin"};
function timeLabel(date: string, start?: string) { return `${date.slice(5)}${start ? ` ${start}` : ""}`; }

export function MapRouteLabels({ map, arcs, locale, onOpenEntry }: { map: MapLibreMap; arcs: TravelArc[]; locale: Locale; onOpenEntry: (entry: Entry) => void }) {
  const [mounts, setMounts] = useState<Array<{ arc: TravelArc; element: HTMLDivElement }>>([]);
  const [history, setHistory] = useState<{ arc: TravelArc; left: number; top: number } | null>(null);
  const transport = useMemo(() => arcs.filter(arc => arc.journeys.some(journey => journey.entry)).sort((a, b) => b.journeys[0].date.localeCompare(a.journeys[0].date) || (b.journeys[0].start ?? "").localeCompare(a.journeys[0].start ?? "")), [arcs]);
  const zh = locale === "zh";
  const historyRef = useRef<HTMLElement>(null);
  useFocusTrap(historyRef, Boolean(history));
  useModalDismiss(event => { event.preventDefault(); setHistory(null); }, Boolean(history));
  useEffect(() => {
    const nodes = transport.map(arc => {
      const points = greatCircleArc(arc.from.point, arc.to.point);
      const midpoint = points[Math.floor(points.length / 2)];
      const element = document.createElement("div"); element.className = "map-route-label";
      element.addEventListener("click", event => event.stopPropagation());
      element.addEventListener("pointerdown", event => event.stopPropagation());
      const marker = new Marker({element, anchor:"center"}).setLngLat(midpoint).addTo(map);
      return { arc, element, marker, midpoint };
    });
    const update = () => {
      const zoom = map.getZoom(), placed: Array<{ x: number; y: number }> = [];
      const { width, height } = map.getContainer().getBoundingClientRect();
      for (const node of nodes) {
        const point = map.project(node.midpoint);
        const min = ARC_TIERS.find(tier => tier.tier === arcTier(node.arc.km))!.minZoom;
        const show = zoom >= Math.max(3.5, min) && point.x > 40 && point.x < width - 40 && point.y > 40 && point.y < height - 35 && placed.length < 16 && !placed.some(other => Math.abs(other.x-point.x)<200 && Math.abs(other.y-point.y)<38);
        node.element.style.display = show ? "" : "none";
        if (show) placed.push(point);
      }
    };
    const close = () => setHistory(null);
    map.on("move", update); map.on("movestart", close);
    setMounts(nodes); update();
    return () => { map.off("move", update); map.off("movestart", close); nodes.forEach(node => node.marker.remove()); };
  }, [map, transport]);
  useEffect(() => { if (history && !transport.some(arc => arc.id === history.arc.id)) setHistory(null); }, [transport, history]);
  return <>{mounts.map(({arc,element}) => {
    const journeys=arc.journeys.filter(journey => journey.entry), latest=journeys[0];
    if (!latest?.entry) return null;
    return createPortal(<><button className="map-route-latest" type="button" onClick={() => onOpenEntry(latest.entry!)} title={`${latest.date} ${latest.start ?? ""} · ${latest.title}`}><Icon name={icons[latest.mode ?? "trip"]} size={13} /><time>{timeLabel(latest.date,latest.start)}</time><span>{latest.title}</span></button>
      {journeys.length>1 && <button className="map-route-more" type="button" aria-label={zh ? `查看其他 ${journeys.length-1} 次交通` : `Show ${journeys.length-1} other journeys`} onClick={event => { const rect=event.currentTarget.getBoundingClientRect(); setHistory({arc,left:Math.max(8,Math.min(rect.right-300,window.innerWidth-316)),top:Math.max(8,Math.min(rect.bottom+8,window.innerHeight-330))}); }}>+{journeys.length-1}</button>}</>,element,arc.id);
  })}
  {history && createPortal(<div className="map-route-history-backdrop" onClick={() => setHistory(null)}><section ref={historyRef} className="map-route-history" role="dialog" aria-label={zh ? "路线交通记录" : "Route journeys"} style={{left:history.left,top:history.top}} onClick={event => event.stopPropagation()}>
    <header><div><strong>{zh ? "这条路线的交通" : "Journeys on this route"}</strong><small>{history.arc.from.address} ⇄ {history.arc.to.address}</small></div><button type="button" className="icon-button subtle" aria-label={zh ? "关闭" : "Close"} onClick={() => setHistory(null)}><Icon name="close" size={14}/></button></header>
    <ol>{history.arc.journeys.filter(journey => journey.entry).map((journey,index) => <li key={journey.id}><button type="button" onClick={() => { setHistory(null); onOpenEntry(journey.entry!); }}><Icon name={icons[journey.mode ?? "trip"]} size={15}/><span><time>{journey.date} {journey.start}{index===0 ? (zh ? " · 最新" : " · Latest") : ""}</time><strong>{journey.title}</strong><small>{journey.from.address} → {journey.to.address}</small></span><Icon name="arrow-right" size={12}/></button></li>)}</ol>
    <footer>{zh ? "按时间与相邻地点关联，点击可核对原记录" : "Matched by time and neighboring places. Open a record to verify."}</footer>
  </section></div>,document.body)}
  </>;
}
