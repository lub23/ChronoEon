// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEntryId, createDefaultSettings } from "@chronoeon/domain";
import { AiConversationStore, SqliteEntryStore, SyncEngine, SyncStore, TimerStore, type Publication, type RemoteIndex, type SyncBackend } from "@chronoeon/storage";
import { MemorySqliteBackend } from "@chronoeon/storage/test";
import { settingsSyncPayload } from "./domain/dataTransfer";
import App from "./App";

const mobile = vi.hoisted(() => ({ enabled:false, session:null as any, remote:null as any, boots:0, fetches:0 }));
vi.mock("./platform/desktop",async(importOriginal)=>({ ...await importOriginal<typeof import("./platform/desktop")>(), isTauri:()=>mobile.enabled }));
vi.mock("./platform/globalShortcut",async(importOriginal)=>({ ...await importOriginal<typeof import("./platform/globalShortcut")>(),
  registerCaptureShortcut:vi.fn(async()=>({status:"unsupported"})),registerMiniShortcut:vi.fn(async()=>({status:"unsupported"})),unregisterCaptureShortcut:vi.fn(async()=>{}),unregisterMiniShortcut:vi.fn(async()=>{}) }));
vi.mock("@tauri-apps/api/core",()=>({ invoke:vi.fn(async()=>undefined) }));
vi.mock("./platform/sqliteSession",async(importOriginal)=>({ ...await importOriginal<typeof import("./platform/sqliteSession")>(),
  createSqliteStoreSession:vi.fn(async()=>{mobile.boots++;return mobile.session;}) }));
vi.mock("./sync/client",()=>({
  NativeSyncBackend:class { readonly id="mobile-remote"; async fetch(known:Record<string,string>){mobile.fetches++;return mobile.remote.fetch(known);} async publish(publication:Publication){return mobile.remote.publish(publication);} },
  prepareAttachmentImports:vi.fn(async()=>{}),
}));
class Remote implements SyncBackend {
  readonly id="other-remote";
  index:RemoteIndex|null=null; head=0; docs=new Map<string,{content:string;hash:string}>();
  async fetch(known:Record<string,string>){const index=structuredClone(this.index);return{index,head:this.head?String(this.head):null,
    documents:[...(index?.snapshot?[index.snapshot]:[]),...index?.batches??[]].filter((ref)=>known[ref.path]!==ref.hash).map((ref)=>({path:ref.path,...this.docs.get(ref.path)!}))};}
  async publish(publication:Publication){if(publication.expectedHead!==(this.head?String(this.head):null))return{conflict:true};for(const doc of publication.documents)this.docs.set(doc.path,doc);this.index=structuredClone(publication.index);this.head++;return{conflict:false};}
}
let host:HTMLDivElement;let root:Root;let otherBackend:MemorySqliteBackend;
beforeEach(async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("ResizeObserver",class {observe(){}unobserve(){}disconnect(){}});
  Element.prototype.scrollTo=vi.fn();Element.prototype.scrollBy=vi.fn();
  Object.defineProperty(navigator,"userAgent",{configurable:true,value:"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile"});
  localStorage.clear();localStorage.setItem("chronoeon.preference.locale", JSON.stringify("zh"));localStorage.setItem("chronoeon.preference.syncConfig",JSON.stringify({mode:"git",gitRemote:"https://gitee.com/example/data.git",gitToken:"test",webdavUrl:"",webdavUsername:"",webdavPassword:""}));
  const backend=await MemorySqliteBackend.open([]); const store=await SqliteEntryStore.create(backend);
  mobile.session={store,sync:new SyncStore(backend),conversations:new AiConversationStore(backend),timers:new TimerStore(backend),dispose:vi.fn(()=>backend.close())};
  mobile.remote=new Remote();mobile.boots=0;mobile.fetches=0;mobile.enabled=true;
  otherBackend=await MemorySqliteBackend.open([]);const other=await SqliteEntryStore.create(otherBackend);const otherSync=new SyncStore(otherBackend);
  const now=new Date();const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  await other.create({id:createEntryId(),kind:"task",title:"Synced entry stays visible",date,allDay:true,category:"work",color:"#77787b",createdAt:now.toISOString()});
  await otherSync.setSettings(settingsSyncPayload({ ...createDefaultSettings(), language: "zh" },{theme:"dark"}));
  await new SyncEngine(otherSync,mobile.remote,{deviceName:"Other device"}).run();
  host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);
});
afterEach(async()=>{act(()=>root.unmount());host.remove();await mobile.session.dispose();await otherBackend.close();mobile.enabled=false;vi.unstubAllGlobals();});
describe("mobile logical sync lifecycle",()=>{
  it("imports a snapshot through the live SQLite store, without any database reboot or startup loop",async()=>{
    act(()=>root.render(<App/>));
    // Let the SQLite boot render, then the settings hydration render, before
    // advancing past the connection debounce (React batches inside each act).
    await act(async()=>{await new Promise((resolve)=>setTimeout(resolve,50));});
    await act(async()=>{await new Promise((resolve)=>setTimeout(resolve,50));});
    await act(async()=>{await new Promise((resolve)=>setTimeout(resolve,1200));});
    expect(mobile.fetches).toBe(1);expect(mobile.boots).toBe(1);expect(mobile.session.dispose).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Synced entry stays visible");expect(localStorage.getItem("chronoeon.preference.theme")).toBe('"dark"');
    expect(await mobile.session.sync.conflicts()).toEqual([]);
    await act(async()=>{await new Promise((resolve)=>setTimeout(resolve,400));});expect(mobile.fetches).toBe(1);
    await act(async()=>{window.dispatchEvent(new Event("online"));await new Promise((resolve)=>setTimeout(resolve,150));});
    expect(mobile.fetches).toBe(2);
    Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});
    await act(async()=>{document.dispatchEvent(new Event("visibilitychange"));await new Promise((resolve)=>setTimeout(resolve,150));});
    expect(mobile.fetches).toBe(3);expect(mobile.boots).toBe(1);
  },10000);
});


it("rebuilds from Settings → Data and refreshes the recycle bin without reopening SQLite", async () => {
  act(() => root.render(<App />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1200)); });
  const stored = (await mobile.session.store.list())[0];
  await act(async () => { await mobile.session.store.delete(stored.id); });
  await act(async () => { host.querySelector<HTMLButtonElement>('.sidebar-utility[aria-label="设置"]')!.click(); });
  const data = [...host.querySelectorAll<HTMLButtonElement>(".settings-nav button")].find((button) => button.textContent?.includes("数据"))!;
  await act(async () => { data.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(host.querySelector(".recycle-bin-list")?.textContent).toContain(stored.title);
  const generation = mobile.remote.index.snapshot.generation;
  const rebuild = host.querySelector<HTMLButtonElement>(".sync-rebuild-button")!;
  expect(rebuild.disabled).toBe(false);
  await act(async () => { rebuild.click(); });
  expect(mobile.remote.index.snapshot.generation).toBe(generation);
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("清空回收站");
  await act(async () => {
    document.querySelector<HTMLButtonElement>('.confirm-actions .danger-button')!.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  expect(mobile.remote.index.snapshot.generation).toBe(generation + 1);
  expect(await mobile.session.store.deletedEntries()).toEqual([]);
  expect(host.querySelector(".recycle-bin")?.textContent).toContain("没有可恢复的删除记录");
  expect(host.querySelector(".sync-snapshot-schedule time")?.getAttribute("datetime")).toBe(new Date(Date.parse(mobile.remote.index.snapshot.createdAt) + 7 * 86400000).toISOString());
  expect(mobile.boots).toBe(1);
}, 10000);
