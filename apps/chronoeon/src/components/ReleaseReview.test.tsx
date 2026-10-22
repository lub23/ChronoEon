// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultSettings, draftToItem, type Entry } from "@chronoeon/domain";
import { ItemsView } from "./ItemsView";
import { GlassDatePicker } from "./GlassDateTimePicker";
import { CategoryCatalogManager } from "./CategoryCatalogManager";
import { SearchResults } from "./SearchResults";
import { ImagePreview } from "./ImagePreview";
import { SidebarUpdate } from "./SidebarUpdate";
import { resolveAttachmentUrl } from "../platform/attachments";
import { checkForAppUpdate, installAppUpdate, openUpdatePage } from "../platform/update";
import { t } from "../i18n";

vi.mock("../platform/attachments", () => ({ resolveAttachmentUrl: vi.fn(), releaseAttachment: vi.fn() }));
vi.mock("../platform/desktop", () => ({ isTauri: () => true, readAppVersion: async () => "3.0.2" }));
vi.mock("../platform/update", () => ({ checkForAppUpdate: vi.fn(), downloadAppUpdate: vi.fn(async () => "/tmp/update.apk"), installAppUpdate: vi.fn(), openUpdatePage: vi.fn() }));
const settings = createDefaultSettings("en");
const today = "2026-10-23";
const asset = (id: string, cost = 10, currency = "CNY") => ({ ...draftToItem({ name: `Camera ${id}`, calendarId: settings.defaultCalendarID, category: "electronics", acquisition: "purchase", acquiredOn: "2026-10-01", acquiredAt: "09:00", currency, cost }), id });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 12));
  localStorage.clear(); vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
const click = (selector: string) => act(() => document.querySelector<HTMLButtonElement>(selector)!.click());
function fill(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

it.each(["en", "zh"] as const)("names the asset page and explains unmatched searches in %s", locale => {
  act(() => root.render(<ItemsView items={[asset("one")]} entries={[]} locale={locale} settings={settings} today={today} search="missing" />));
  expect(host.querySelector("h2")?.textContent).toBe(t("items", locale));
  expect(host.querySelector(".stats-empty")?.textContent).toContain(t("itemsSearchEmpty", locale));
  expect(host.querySelector(".stats-empty")?.textContent).not.toBe(t("itemsEmpty", locale));
});

it.each(["cost", "daily"])("sorts %s amounts in the requested direction within each currency", field => {
  localStorage.setItem("chronoeon.preference.items-sort-field", JSON.stringify(field));
  const items = [asset("cheap", 10), asset("expensive", 100), asset("usd", 50, "USD")];
  act(() => root.render(<ItemsView items={items} entries={[]} locale="en" settings={settings} today={today} />));
  const names = () => [...host.querySelectorAll(".item-identity strong")].map(node => node.textContent);
  expect(names().filter(name => name !== "Camera usd")).toEqual(["Camera expensive", "Camera cheap"]);
  click(".item-sort-direction");
  expect(names().filter(name => name !== "Camera usd")).toEqual(["Camera cheap", "Camera expensive"]);
});

it.each(["en", "zh"] as const)("labels the entire date and marks today in %s", locale => {
  act(() => root.render(<GlassDatePicker inline value={today} locale={locale} ariaLabel="Date" onChange={vi.fn()} />));
  const cell = host.querySelector<HTMLButtonElement>('.glass-date-cell[aria-current="date"]');
  expect(cell?.getAttribute("aria-label")).toContain("2026");
  expect(cell?.getAttribute("aria-label")).toContain("23");
});

it.each([{ min: "2026-10-24" }, { max: "2026-10-22" }])("prevents Today from bypassing date bounds %j", bounds => {
  const change = vi.fn();
  act(() => root.render(<GlassDatePicker inline value={today} locale="en" ariaLabel="Date" onChange={change} {...bounds} />));
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Today"]')!;
  expect(button.disabled).toBe(true);
  act(() => button.click()); expect(change).not.toHaveBeenCalled();
});

it("includes the last Sunday and updates the grid when week-start changes", () => {
  const render = (weekStartsOn: 0 | 1) => act(() => root.render(<GlassDatePicker inline value="2027-01-31" locale="en" weekStartsOn={weekStartsOn} ariaLabel="Date" onChange={vi.fn()} />));
  render(0);
  expect([...host.querySelectorAll(".glass-date-cell:not(.is-outside)")].map(node => node.textContent)).toContain("31");
  expect(host.querySelector(".glass-date-week span")?.textContent).toBe("S");
  render(1);
  expect(host.querySelector(".glass-date-week span")?.textContent).toBe("M");
  expect(host.querySelector(".glass-date-cell")?.textContent).toBe("28");
});

it.each([false, true])("keeps blank categories open and ignores IME Enter before trimming (editing: %s)", editing => {
  const change = vi.fn();
  act(() => root.render(<CategoryCatalogManager locale="zh" label="分类" mode="item" categories={editing ? [{ id: "camera", name: "Camera", color: "#777777" }] : []} onChange={change} onDelete={vi.fn()} />));
  click(editing ? ".category-edit-button" : ".category-add");
  const input = document.querySelector<HTMLInputElement>(".category-name-input")!;
  fill(input, "   ");
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(change).not.toHaveBeenCalled();
  fill(input, "  相机  ");
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })));
  expect(change).not.toHaveBeenCalled();
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(change).toHaveBeenCalledWith([expect.objectContaining({ name: "相机" })]);
});

it("keeps update failures retryable and disables a pending page handoff", async () => {
  vi.mocked(checkForAppUpdate).mockResolvedValue({ version: "3.0.3", url: "", size: 0, name: "", pageUrl: "https://example.com/release" });
  let reject!: (error: Error) => void;
  vi.mocked(openUpdatePage).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  await act(async () => root.render(<SidebarUpdate locale="zh" collapsed={false} />));
  await act(async () => document.querySelector<HTMLButtonElement>(".sidebar-utility")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>(".sidebar-update-install")!.click());
  expect(document.querySelector<HTMLButtonElement>(".sidebar-utility")!.disabled).toBe(true);
  expect(document.querySelector(".sidebar-update-note")?.textContent).toBe(t("updateOpeningPage", "zh"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await act(async () => reject(new Error("could not launch browser")));
  expect(document.querySelector<HTMLButtonElement>(".sidebar-utility")!.disabled).toBe(false);
  await act(async () => document.querySelector<HTMLButtonElement>(".sidebar-utility")!.click());
  expect(document.querySelector(".sidebar-update-install")?.textContent).toBe(t("updateOpenPage", "zh"));
  warn.mockRestore();
});

it.each(["entry", "item"] as const)("makes the 25th matching %s reachable and resets a changed query", kind => {
  const entries: Entry[] = Array.from({ length: 30 }, (_, n) => ({ id: `e${n}`, kind: "event", title: `Camera ${n}`, date: today, category: "work", color: "#777777", createdAt: `${today}T00:00:00Z` }));
  const items = Array.from({ length: 30 }, (_, n) => asset(String(n)));
  const open = vi.fn();
  const render = (search: string) => act(() => root.render(<SearchResults entries={kind === "entry" ? entries : []} items={kind === "item" ? items : []} search={search} locale="en" settings={settings} onOpen={open} onOpenItem={open} />));
  render("Camera");
  expect(host.querySelectorAll(".filter-result")).toHaveLength(24);
  click(".filter-results-more");
  expect(host.querySelectorAll(".filter-result")).toHaveLength(30);
  act(() => host.querySelectorAll<HTMLButtonElement>(".filter-result")[24].click());
  expect(open).toHaveBeenCalledOnce();
  render("Camera ");
  render("Camera");
  expect(host.querySelectorAll(".filter-result")).toHaveLength(24);
});

it("shows a ready photo while another remains pending without re-reading it on rerender", async () => {
  let finish!: (value: string) => void;
  vi.mocked(resolveAttachmentUrl).mockImplementation(reference => reference === "fast" ? Promise.resolve("data:image/png;base64,fast") : new Promise(resolve => { finish = resolve; }));
  const render = async () => act(async () => root.render(<ImagePreview locale="en" items={["fast", "slow"]} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />));
  await render();
  expect(document.querySelector(".image-preview-main img")?.getAttribute("src")).toBe("data:image/png;base64,fast");
  await render();
  expect(resolveAttachmentUrl).toHaveBeenCalledTimes(2);
  await act(async () => finish("data:image/png;base64,slow"));
  expect(document.querySelectorAll(".image-preview-thumb img")).toHaveLength(2);
});

it.each([false, true])("allows another update check after handing off (installer asset: %s)", async hasAsset => {
  vi.mocked(checkForAppUpdate).mockResolvedValue({ version: "3.0.3", url: hasAsset ? "https://example.com/app.apk" : "", size: 1, name: "app.apk", pageUrl: "https://example.com/release" });
  vi.mocked(openUpdatePage).mockResolvedValue(); vi.mocked(installAppUpdate).mockResolvedValue();
  await act(async () => root.render(<SidebarUpdate locale="en" collapsed={false} />));
  await act(async () => document.querySelector<HTMLButtonElement>(".sidebar-utility")!.click());
  if (!hasAsset) expect(document.querySelector(".sidebar-update-install")?.textContent).toContain("release page");
  await act(async () => document.querySelector<HTMLButtonElement>(".sidebar-update-install")!.click());
  expect(hasAsset ? installAppUpdate : openUpdatePage).toHaveBeenCalledOnce();
  expect(document.querySelector<HTMLButtonElement>(".sidebar-utility")!.disabled).toBe(false);
  await act(async () => document.querySelector<HTMLButtonElement>(".sidebar-utility")!.click());
  expect(checkForAppUpdate).toHaveBeenCalledTimes(2);
});
