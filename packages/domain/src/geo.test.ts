import { describe, expect, it } from "vitest";
import { movementArcs, nearestPlaces, transportMode, nearbyGeoClusters, clusterByAddress, type LocatedRecord } from "./geo";
const visit = (address: string, date: string, start?: string): LocatedRecord => ({ id: `${address}:${date}:${start}`, kind: "entry", address, date, start, title: address, images: [], point: { lng: address === "A" ? 116.3 : 116.32, lat: 40 }, precision: "precise" });
describe("observed map routes", () => {
  it("cuts unknown times, long gaps and midnight, and merges repeated return routes", () => {
    expect(movementArcs([visit("A", "2026-11-01", "09:00"), visit("B", "2026-11-01", "10:00"), visit("A", "2026-11-01", "11:00"), visit("B", "2026-11-01", "17:00"), visit("A", "2026-11-02", "09:00"), visit("B", "2026-11-02")])).toHaveLength(1);
    expect(movementArcs([visit("A", "2026-11-01", "23:50"), visit("B", "2026-11-02", "00:10")])).toEqual([]);
  });
  it("does not suggest approximate or excluded historical coordinates", () => {
    expect(nearestPlaces({ lng: 116.3, lat: 40 }, [{ address: "approx", lng: 116.3, lat: 40, score: 60, level: "district" }, { address: "known", lng: 116.3001, lat: 40, score: 90, level: "gps" }]).map(hit => hit.place.address)).toEqual(["known"]);
  });
});

it("uses explicit transportation to bridge long and overnight moves, keeping route history newest first", () => {
  const travel=(id:string,title:string,date:string,start:string)=>({id,title,date,start,kind:"event" as const,category:"default",color:"#000",createdAt:date+"T00:00:00Z"});
  const records=[visit("A","2026-11-01","23:00"),visit("B","2026-11-02","07:00"),visit("B","2026-11-03","08:00"),visit("A","2026-11-03","16:00")];
  const arcs=movementArcs(records,[travel("flight","飞回北京","2026-11-02","01:00"),travel("train","高铁出差","2026-11-03","10:00")]);
  expect(arcs).toHaveLength(1);expect(arcs[0].journeys.map(journey=>journey.entry?.id)).toEqual(["train","flight"]);
  expect(arcs[0].from.address).toBe("B");expect(arcs[0].journeys[1].sameDay).toBe(false);
  expect(movementArcs(records)).toEqual([]);
});
it("leaves ambiguous all-day transportation unmatched and avoids non-travel titles",()=>{
  const records=[visit("A","2026-11-01","08:00"),visit("B","2026-11-01","12:00"),visit("A","2026-11-01","18:00")];
  const entry={id:"unclear",title:"坐车",date:"2026-11-01",kind:"event" as const,category:"default",color:"#000",createdAt:"2026-11-01T00:00:00Z"};
  expect(movementArcs(records,[entry])).toEqual([]);
  expect(transportMode("飞书会议")).toBeUndefined();expect(transportMode("出差回顾")).toBeUndefined();expect(transportMode("出差前午饭")).toBeUndefined();
  expect(transportMode("地铁回学校")).toBe("metro");expect(transportMode("Walk home")).toBe("walk");
});
it("groups nearby places only in the far view and bounds the neighborhood",()=>{
  const a=visit("A","2026-11-01","09:00"),b={...visit("B","2026-11-01","10:00"),point:{lng:116.31,lat:40}};
  const clusters=clusterByAddress([a,b]);const project=(point:{lng:number;lat:number})=>({x:point.lng*100,y:point.lat*100});
  expect(nearbyGeoClusters(clusters[0],clusters,8,project)).toHaveLength(2);
  expect(nearbyGeoClusters(clusters[0],clusters,12,project)).toHaveLength(1);
});
