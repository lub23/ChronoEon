// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { clusterByAddress,createDefaultSettings,locateRecords,type Entry } from "@chronoeon/domain";
import { MapPlacePanel } from "./MapPlacePanel";
let host:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const settings=createDefaultSettings("en");
const entries:Entry[]=[{id:"a",kind:"event",title:"Lunch",date:"2026-11-01",start:"12:00",category:"default",location:"Cafe",note:"Rice and vegetables",images:["data:image/png;base64,iVBORw0KGgo="],color:"#111",createdAt:"2026-11-01T00:00:00Z"},{id:"b",kind:"event",title:"Read",date:"2026-11-01",start:"14:00",category:"default",location:"Library",color:"#111",createdAt:"2026-11-01T00:00:00Z"}];
const groups=clusterByAddress(locateRecords(entries,[],{start:"2026-11-01",end:"2026-11-01"},address=>({address,lng:address==="Cafe"?116.3:116.31,lat:40,score:100,level:"manual"})));
const handlers={onExpanded:vi.fn(),onPhotosOnly:vi.fn(),onClose:vi.fn(),onFocus:vi.fn(),onOpenEntry:vi.fn(),onOpenItem:vi.fn()};
it("collapses the panel without clearing its selected place",()=>{
  act(()=>root.render(<MapPlacePanel selected={groups[0]} groups={groups} locale="en" settings={settings} expanded={false} photosOnly={false} {...handlers}/>));
  expect(host.textContent).toContain("2 nearby places");expect(host.querySelector(".map-place-groups")).toBeNull();
  act(()=>host.querySelector<HTMLButtonElement>(".map-panel-toggle")!.click());expect(handlers.onExpanded).toHaveBeenCalledWith(true);
});
it("groups nearby locations and reuses the photo frame with notes and time",async()=>{
  await act(async()=>root.render(<MapPlacePanel selected={groups[0]} groups={groups} locale="en" settings={settings} expanded photosOnly {...handlers}/>));
  expect(host.querySelectorAll(".map-place-group")).toHaveLength(1);
  expect(host.querySelector(".photo-wall-stack")).toBeTruthy();expect(host.querySelector(".photo-wall-note")?.textContent).toBe("Rice and vegetables");
  expect(host.querySelector(".photo-wall-meta")?.textContent).toContain("2026-11-01 · 12:00");
});
