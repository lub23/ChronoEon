// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocationField } from "./LocationField";
import { PlaceManager } from "./PlaceManager";
import { PlaceServicesContext, type PlaceServices } from "./PlaceServices";
import { readNearbyPlace } from "../platform/location";
import { geocodeAddress } from "../platform/geocode";
vi.mock("../platform/location", () => ({ requestCoordinates: vi.fn(async () => null), readNearbyPlace: vi.fn(), placeNameCandidates: vi.fn() }));
vi.mock("../platform/geocode", () => ({ geocodeConfigured: () => true, geocodeAddress: vi.fn() }));
vi.mock("./MapPointPicker", () => ({ MapPointPicker: ({ onSelect }: { onSelect: (point: {lng: number;lat: number}) => void }) => <button className="test-pick" onClick={() => onSelect({lng:116.4,lat:40})}>Choose point</button> }));
let root: Root, host: HTMLDivElement, services: PlaceServices;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  services = { places: new Map([["Office", { address:"Office",lng:116.3,lat:40,score:100,level:"manual" }]]), addresses:["Office"], counts:new Map([["Office",3]]), config:{provider:"amap",endpoint:"",id:"",key:"test"}, cache:vi.fn(async () => {}), rename:vi.fn(async () => {}) };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });
function Field() { const [value,setValue]=useState(""); return <LocationField locale="en" value={value} onChange={name => setValue(name ?? "")} auto={false} />; }
it("opens map picking with an empty name and saves the selected point", async () => {
  act(() => root.render(<PlaceServicesContext.Provider value={services}><Field /></PlaceServicesContext.Provider>));
  const button=host.querySelector<HTMLButtonElement>('[aria-label="Pick on map"]')!;
  expect(button.disabled).toBe(false);
  await act(async () => { button.click(); await vi.dynamicImportSettled(); });
  expect(host.querySelector(".test-pick")).toBeTruthy();
  await act(async () => host.querySelector<HTMLButtonElement>(".test-pick")!.click());
  expect(services.cache).toHaveBeenCalledWith(expect.stringContaining("Pinned place"),{lng:116.4,lat:40},"manual",100);
  expect(host.querySelector(".location-status.is-saved")).toBeTruthy();
});
it("fills the first GPS candidate and keeps the saved indicator beside the heading", async () => {
  vi.mocked(readNearbyPlace).mockResolvedValue({label:"Cafe",candidates:["Cafe","Library"],latitude:40,longitude:116.4,fromHistory:false});
  act(() => root.render(<PlaceServicesContext.Provider value={services}><Field /></PlaceServicesContext.Provider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Use my current location"]')!.click());
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Location"]')!.value).toBe("Cafe");
  expect(host.querySelector(".location-heading > .location-status.is-saved")).toBeTruthy();
  expect(host.querySelector(".location-feedback")).toBeNull();
});
it("stages looked-up coordinates and writes only when Update is clicked", async () => {
  vi.mocked(geocodeAddress).mockResolvedValue({ok:true,lng:116.4,lat:40.1,score:90,level:"POI",message:null});
  act(() => root.render(<PlaceServicesContext.Provider value={services}><PlaceManager locale="en" /></PlaceServicesContext.Provider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Places"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent?.includes("Office"))!.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes("Look up coordinates"))!.click());
  expect(services.cache).not.toHaveBeenCalled(); expect(services.rename).not.toHaveBeenCalled();
  expect(host.querySelectorAll(".place-unsaved")).toHaveLength(2);
  await act(async () => host.querySelector<HTMLButtonElement>(".place-update")!.click());
  expect(services.cache).toHaveBeenCalledWith("Office",{lng:116.4,lat:40.1},"manual",100);
  expect(host.querySelector(".place-unsaved")).toBeNull();
});
