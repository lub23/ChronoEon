// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings, draftToItem, type Item, type ItemDraft, type Entry } from "@chronoeon/domain";
import { ItemsView } from "./ItemsView";
import { ItemEditor } from "./ItemEditor";
import { BillItemLinks } from "./BillItemLinks";

vi.mock("../platform/attachments", () => ({ pickItemCover: vi.fn(async () => null), resolveAttachmentUrl: vi.fn(async () => null) }));
const settings = createDefaultSettings("en");
const today = "2026-09-30";
function item(patch: Partial<Item> = {}): Item {
  return { ...draftToItem({ name: "Camera", category: "electronics", acquisition: "purchase", acquiredOn: "2026-09-01", acquiredAt: "09:00", cost: 300, currency: "CNY" }), ...patch };
}
function bill(patch: Partial<Entry> = {}): Entry {
  return { id: "bill-id", title: "Camera receipt", kind: "bill", color: "#77787b", amount: 300, currency: "CNY", category: settings.bill.categories.find(item => item.direction === "expense")!.id, date: "2026-09-01", createdAt: "2026-09-01T00:00:00Z", ...patch };
}
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.clearAllMocks(); });
function choose(label: string, value: string) {
  act(() => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent?.includes(value))!.click());
}
function field(label: string) {
  return [...document.querySelectorAll(".item-editor-fields label")].find(item => item.textContent?.startsWith(label))!.querySelector<HTMLInputElement>("input")!;
}
function fill(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("item inventory", () => {
  it("shows acquisition date, inclusive days, daily cost and separate history", () => {
    const current = item(), past = item({ id: "past", name: "Old coat", disposal: "lost", disposedOn: "2026-09-10" });
    act(() => root.render(<ItemsView items={[current, past]} entries={[]} settings={settings} locale="en" today={today} />));
    expect(host.querySelectorAll(".item-card")).toHaveLength(1);
    expect([...host.querySelectorAll(".item-facts dd")].map(item => item.textContent)).toEqual(["2026-09-01 09:00", "30", "￥300.00", "￥10.00"]);
    act(() => [...host.querySelectorAll<HTMLButtonElement>(".items-toolbar button")].find(button => button.textContent?.startsWith("History"))!.click());
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
  it("exposes reverse association from bill without creating a second record", () => {
    const receipt = bill(), owned = item({ purchaseEntryId: receipt.id }), edit = vi.fn(), link = vi.fn();
    act(() => root.render(<BillItemLinks entry={receipt} items={[owned]} locale="en" settings={settings} onEdit={edit} onLink={link} />));
    act(() => host.querySelector<HTMLButtonElement>(".item-bill-link")!.click());
    expect(edit).toHaveBeenCalledWith(owned);
    expect(link).not.toHaveBeenCalled();
    expect(host.querySelector(".bill-items-actions")).toBeNull();
  });
});

describe("item editor", () => {
  it("copies an expense bill snapshot and saves it once", async () => {
    const receipt = bill(), save = vi.fn(async () => {}), close = vi.fn();
    act(() => root.render(<ItemEditor items={[]} entries={[receipt]} settings={settings} locale="en" today={today} onSave={save} onClose={close} />));
    fill(field("Asset name"), "Camera");
    choose("Purchase bill (optional)", "Camera receipt");
    expect(field("Acquired on").value).toBe(receipt.date);
    expect(field("Acquisition cost").value).toBe("300");
    await act(async () => { document.querySelector(".item-editor")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "Camera", purchaseEntryId: receipt.id, acquiredOn: receipt.date, cost: 300 }), undefined);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("gifts clear purchase bindings and use zero cost", async () => {
    const save = vi.fn(async (_draft: ItemDraft, _id?: string) => {});
    act(() => root.render(<ItemEditor item={item({ purchaseEntryId: "bill-id" })} items={[]} entries={[bill()]} settings={settings} locale="en" today={today} onSave={save} onClose={() => {}} />));
    choose("Acquired by", "Gift");
    expect(document.querySelector('button[aria-label="Purchase bill (optional)"]')).toBeNull();
    await act(async () => { document.querySelector(".item-editor")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(save.mock.calls[0][0]).toMatchObject({ acquisition: "gift", cost: 0, purchaseEntryId: undefined });
  });
  it.each(["Lost", "Discarded", "Sold second-hand"])("archives via %s and retains the form on failed persistence", async disposal => {
    const close = vi.fn(), save = vi.fn(async () => { throw new Error("disk full"); });
    act(() => root.render(<ItemEditor item={item()} items={[]} entries={[]} settings={settings} locale="en" today={today} onSave={save} onClose={close} />));
    choose("Disposal", disposal);
    expect(field("Disposed on").value).toBe(today);
    await act(async () => { document.querySelector(".item-editor")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>('.item-editor button[type="submit"]')!.disabled).toBe(false);
  });
});
