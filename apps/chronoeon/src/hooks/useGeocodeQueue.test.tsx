// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { GeocodeRow, GeocodeStore } from "@chronoeon/storage";
import { useGeocodeQueue, type GeocodeQueue } from "./useGeocodeQueue";

it("refreshes received coordinates and removals without a geocoder configuration", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  let rows: GeocodeRow[] = [{address:"Office",lng:116,lat:40,score:100,level:"manual",updatedAt:"2026-11-03T00:00:00Z"}];
  const store = {all:vi.fn(async () => rows)} as unknown as GeocodeStore;
  const config = {provider:"apihz" as const,endpoint:"",id:"",key:""};
  const entries: [] = [], items: [] = [];
  let queue!: GeocodeQueue;
  function Probe() { queue = useGeocodeQueue(store,entries,items,config); return null; }
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<Probe/>));
    expect(queue.precise[0]).toMatchObject({lng:116,lat:40});
    rows = [{...rows[0],lng:117,lat:41,updatedAt:"2026-11-03T01:00:00Z"}];
    await act(async () => queue.reload());
    expect(queue.precise[0]).toMatchObject({lng:117,lat:41});
    expect(queue.pending).toBe(0);
    rows = [];
    await act(async () => queue.reload());
    expect(queue.places.size).toBe(0);
  } finally { act(() => root.unmount()); }
});
