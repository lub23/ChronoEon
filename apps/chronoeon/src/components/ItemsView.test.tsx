// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings, draftToItem, type Item, type ItemDraft, type Entry } from "@chronoeon/domain";
import { subscribeImagePreview } from "./photoPreviewBus";
import { ItemsView } from "./ItemsView";
import { EntryComposer } from "./EntryComposer";

vi.mock("../platform/attachments", () => ({ pickEntryAttachments: vi.fn(async () => ({ picked: [], skipped: [] })), releaseAttachment: vi.fn(), resolveAttachmentUrl: vi.fn(async () => null) }));
const settings = createDefaultSettings("en");
const today = "2026-09-30";
function item(patch: Partial<Item> = {}): Item {
  return { ...draftToItem({ name: "Camera", calendarId: "default", category: "electronics", acquisition: "purchase", acquiredOn: "2026-09-01", acquiredAt: "09:00", cost: 300, currency: "CNY" }), ...patch };
}
function bill(patch: Partial<Entry> = {}): Entry {
  return { id: "bill-id", title: "Camera receipt", kind: "bill", color: "#77787b", amount: 300, currency: "CNY", category: settings.calendars[0].billCategories.find(item => item.direction === "expense")!.id, date: "2026-09-01", createdAt: "2026-09-01T00:00:00Z", ...patch };
}
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 30, 12));
  localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.clearAllMocks(); vi.useRealTimers(); });
function choose(label: string, value: string) {
  act(() => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent?.includes(value))!.click());
}
function field(label: string) {
  return [...document.querySelectorAll(".composer-form label")].find(item => item.textContent?.startsWith(label))!.querySelector<HTMLInputElement>("input")!;
}
function fill(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("item inventory", () => {
  it("uses each owning calendar color for the seal, independently of category and default calendar", () => {
    const custom = createDefaultSettings("en");
    custom.calendars[0].color = "#33aa66";
    custom.calendars.push({ ...custom.calendars[0], id: "work", name: "Work", color: "#2255aa", itemCategories: [{ id: "electronics", name: "Electronics", color: "#bb4477", icon: "electronics" }] });
    act(() => root.render(<ItemsView items={[item({ calendarId: "work" })]} entries={[]} settings={custom} locale="en" today={today} />));
    const card = host.querySelector<HTMLElement>(".item-card")!;
    expect(card.style.getPropertyValue("--item-calendar")).toBe("#2255aa");
    expect(card.style.getPropertyValue("--item-category")).toBe("#bb4477");
    expect(host.querySelector(".item-calendar-seal")?.textContent).toBe("W");
  });
  it("opens inventory and editor photos with a single click", async () => {
    const photoItem = item({ images: ["photo-one", "photo-two"] });
    const preview = vi.fn(); const unsubscribe = subscribeImagePreview(preview);
    await act(async () => root.render(<ItemsView items={[photoItem]} entries={[]} settings={settings} locale="en" today={today} />));
    act(() => host.querySelector<HTMLButtonElement>(".item-photo-preview")!.click());
    expect(preview).toHaveBeenLastCalledWith({ items: photoItem.images, index: 0 });
    expect(host.querySelector("button button")).toBeNull();
    await act(async () => root.render(<EntryComposer editing={null} editingItem={photoItem} settings={settings} locale="en" selectedDate={today} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />));
    act(() => host.querySelectorAll<HTMLButtonElement>(".item-photo-preview")[1].click());
    expect(preview).toHaveBeenLastCalledWith({ items: photoItem.images, index: 1 });
    expect(host.querySelector(".attachment-thumb[title]")).toBeNull();
    unsubscribe();
  });
  it("shows acquisition date, inclusive days, daily cost and separate history", () => {
    const current = item(), past = item({ id: "past", name: "Old coat", disposal: "lost", disposedOn: "2026-09-10" });
    act(() => root.render(<ItemsView items={[current, past]} entries={[]} settings={settings} locale="en" today={today} />));
    expect(host.querySelectorAll(".item-card")).toHaveLength(1);
    expect([...host.querySelectorAll(".item-facts dd")].map(item => item.textContent)).toEqual(["2026-09-01 09:00", "30", "￥300.00", "￥10.00"]);
    act(() => [...host.querySelectorAll<HTMLButtonElement>(".items-history-tabs button")].find(button => button.textContent?.startsWith("History"))!.click());
    expect(host.querySelector(".item-card")?.textContent).toContain("Old coat");
    expect([...host.querySelectorAll(".item-facts dd")].map(item => item.textContent)).toEqual(["2026-09-01 09:00", "10", "￥300.00", "￥30.00"]);
    expect(host.querySelector(".item-history-line")?.textContent).toContain("Lost · 2026-09-10");
  });
  it("opens a linked bill and retains unavailable historical links", () => {
    const receipt = bill(), open = vi.fn();
    act(() => root.render(<ItemsView items={[item({ purchaseEntryId: receipt.id }), item({ id: "gone", purchaseEntryId: "deleted" })]} entries={[receipt]} settings={settings} locale="en" today={today} onOpenBill={open} />));
    const links = [...host.querySelectorAll<HTMLButtonElement>(".item-bill-link")];
    expect(links.find(button => button.textContent?.includes("unavailable"))!.disabled).toBe(true);
    act(() => links.find(button => !button.disabled)!.click());
    expect(open).toHaveBeenCalledWith(receipt);
  });
  it("shows the existing category and title jump instead of a second linked-items field", () => {
    const receipt = bill(), owned = item({ purchaseEntryId: receipt.id }), edit = vi.fn();
    act(() => root.render(<EntryComposer entries={[receipt]} items={[owned]} editing={receipt} locale="en" settings={settings} selectedDate={today} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onEditItem={edit} />));
    expect(document.querySelector(".bill-items")).toBeNull();
    const select = document.querySelector<HTMLButtonElement>(".item-from-bill-field button[aria-haspopup]")!;
    expect(select.textContent).toContain("Electronics");
    expect(select.disabled).toBe(true);
    act(() => document.querySelector<HTMLButtonElement>(".item-from-bill-field .icon-button")!.click());
    expect(edit).toHaveBeenCalledWith(owned);
  });
  it("does not mistake the edited item's own bill for a missing bill and can open it", () => {
    const receipt = bill(), owned = item({ purchaseEntryId: receipt.id }), open = vi.fn();
    act(() => root.render(<EntryComposer entries={[receipt]} items={[owned]} editing={null} editingItem={owned} locale="en" settings={settings} selectedDate={today} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onOpenBill={open} />));
    const picker = document.querySelector(".item-bill-picker")!;
    expect(picker.textContent).toContain(receipt.title);
    expect(picker.textContent).not.toContain("unavailable");
    act(() => picker.querySelector<HTMLButtonElement>(".icon-button")!.click());
    expect(open).toHaveBeenCalledWith(receipt);
  });
});

describe("item editor", () => {
  function renderComposer(options: { item?: Item; seed?: Partial<ItemDraft>; entries?: Entry[]; save?: (draft: ItemDraft, id?: string) => Promise<void>; close?: () => void }) {
    act(() => root.render(
      <EntryComposer
        entries={options.entries ?? []}
        items={[]}
        settings={settings}
        locale="en"
        selectedDate={today}
        editing={null}
        editingItem={options.item ?? null}
        initialItemDraft={options.item ? null : options.seed ?? {}}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onSaveItem={options.save ?? vi.fn(async () => {})}
        onDeleteItem={vi.fn()}
        onClose={options.close ?? (() => {})}
      />,
    ));
  }

  it("copies an expense bill snapshot and saves it once", async () => {
    const receipt = bill(), close = vi.fn(), save = vi.fn(async () => { close(); });
    renderComposer({ seed: { name: "" }, entries: [receipt], save, close });
    fill(field("Name"), "Camera");
    choose("Linked bill", "Camera receipt");
    expect(field("Cost").value).toBe("300");
    await act(async () => { document.querySelector(".composer-sheet form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "Camera", purchaseEntryId: receipt.id, acquiredOn: receipt.date, cost: 300 }), undefined);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("gifts clear purchase bindings and use zero cost", async () => {
    const save = vi.fn(async (_draft: ItemDraft, _id?: string) => {});
    renderComposer({ item: item({ purchaseEntryId: "bill-id" }), entries: [bill()], save });
    choose("Acquired by", "Gift");
    expect(document.querySelector('button[aria-label="Linked bill"]')).toBeNull();
    await act(async () => { document.querySelector(".composer-sheet form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(save.mock.calls[0][0]).toMatchObject({ acquisition: "gift", cost: 0, purchaseEntryId: undefined });
  });
  it("normalizes a legacy full acquisition timestamp before saving", async () => {
    const save = vi.fn(async (_draft: ItemDraft, _id?: string) => {});
    renderComposer({ item: item({ id: "camera-id", acquiredAt: "2026-09-01T09:00" }), save });
    await act(async () => { document.querySelector(".composer-sheet form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ acquiredAt: "09:00" }), "camera-id");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it.each(["Discarded", "Sold"])("archives via %s and retains the form on failed persistence", async disposal => {
    const close = vi.fn(), save = vi.fn(async () => { throw new Error("disk full"); });
    renderComposer({ item: item(), save, close });
    choose("Disposal", disposal);
    expect(field("Disposed on").value).toBe(today);
    await act(async () => { document.querySelector(".composer-sheet form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>('.composer-sheet button[type="submit"]')!.disabled).toBe(false);
  });
});
