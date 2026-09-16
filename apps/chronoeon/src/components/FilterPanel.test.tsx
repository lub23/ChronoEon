// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings, type Entry } from "@chronoeon/domain";
import { EMPTY_ENTRY_FILTER, entryMatchesFilter, type EntryFilter } from "../domain/entryFilter";
import type { AgendaFilter } from "../domain/agendaTimeline";
import { FilterPanel } from "./FilterPanel";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const schedule = [{ value: "work", label: "工作", color: "#477b99" }, { value: "life", label: "生活", color: "#888888" }];
const bills = [{ value: "饮食/水果", label: "水果", group: "饮食", color: "#4f8067" }];
const entry: Entry = { id: "e", title: "会议", date: "2026-09-12", kind: "event", category: "work", color: "#477b99", allDay: false, createdAt: "2026-09-12T00:00:00Z", location: "北京海淀清华园", note: "准备".repeat(65) + "清华园会议室" + "后续".repeat(65) };
function setup(entries: Entry[] = []) {
  const change = vi.fn(); const open = vi.fn(); const close = vi.fn(); const apply = vi.fn();
  function Harness() {
    const [filter, setFilter] = useState<EntryFilter>(EMPTY_ENTRY_FILTER);
    const [kind, setKind] = useState<AgendaFilter>([]); const [search, setSearch] = useState("");
    return <FilterPanel locale="zh" settings={createDefaultSettings("zh")} entries={entries.filter(e => entryMatchesFilter(e, filter))}
      kind={kind} filter={filter} search={search} scheduleCategories={schedule} billCategories={bills}
      calendars={[{ id: "default", name: "Default" }]} anchor={{ top: 12, bottom: 45, right: 390 }}
      onKindChange={setKind} onChange={next => { setFilter(next); change(next); }}
      onSearch={value => { setSearch(value); apply(value); }} onOpenEntry={open} onClose={close} />;
  }
  act(() => root.render(<Harness />)); return { change, open, close, apply };
}
function click(button: Element) { act(() => (button as HTMLButtonElement).click()); }
function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  click(document.querySelector(".filter-search-submit")!);
}
describe("unified entry filtering", () => {
  it("places search above calendars and only-photos on the heading's right", () => {
    setup();
    expect([...document.querySelectorAll(".filter-section > .filter-label, .filter-search-section .filter-label")].slice(0, 3).map(e => e.textContent)).toEqual(["搜索", "日历", "类型"]);
    expect(document.querySelector(".filter-panel-header .filter-photos")?.textContent).toBe("仅照片");
    expect(document.querySelector(".filter-category-search")).toBeNull();
    expect(document.querySelectorAll('.filter-category-groups .filter-chip[aria-pressed="true"]')).toHaveLength(3);
    expect([...document.querySelectorAll(".filter-select-all")].map(e => e.textContent)).toEqual(["取消全选", "取消全选"]);
  });
  it("selects and clears each category group independently, including none selected", () => {
    const { change } = setup();
    const toggles = () => document.querySelectorAll(".filter-select-all");
    click(toggles()[0]); expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ categories: [], billCategories: null }));
    expect(toggles()[0].textContent).toBe("全选"); expect(toggles()[1].textContent).toBe("取消全选");
    click(toggles()[1]); expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ categories: [], billCategories: [] }));
    click(toggles()[0]); expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ categories: null, billCategories: [] }));
    click(toggles()[1]); expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ categories: null, billCategories: null }));
  });
  it("searches places and long notes, showing colored categories and bounded highlighted matches", () => {
    const { apply, open, close } = setup([entry]); search("清华园");
    expect(apply).toHaveBeenLastCalledWith("清华园");
    const row = document.querySelector(".filter-result")!;
    expect(row.textContent).toContain("会议"); expect(row.textContent).toContain("地点"); expect(row.textContent).toContain("备注");
    expect(row.querySelector(".filter-result-color")?.getAttribute("style")).toContain("rgb(119, 120, 123)");
    expect([...row.querySelectorAll("mark")].map(e => e.textContent)).toEqual(["清华园", "清华园"]);
    const excerpt = row.querySelectorAll(".filter-result-excerpt")[1].textContent!;
    expect(excerpt).toContain("…"); expect(excerpt.length).toBeLessThan(120);
    expect(document.querySelectorAll(".filter-category-groups .filter-chip")).toHaveLength(3);
    click(row); expect(open).toHaveBeenCalledWith(entry); expect(close).toHaveBeenCalledOnce();
  });
  it("keeps kind checkboxes multi-select and protects the final kind", () => {
    setup(); const by = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.filter-section [role="checkbox"]')].find(e => e.textContent === name)!;
    click(by("账目")); click(by("任务")); click(by("事件")); expect(by("灵感").disabled).toBe(true);
    click(by("事件")); click(by("任务")); click(by("账目"));
    expect([...document.querySelectorAll('.filter-section [role="checkbox"]')].every(e => e.getAttribute("aria-checked") === "true")).toBe(true);
  });
  it("clears search, kind and category state together", () => {
    const { apply, change } = setup([entry]); search("清华园"); click(document.querySelector(".filter-select-all")!);
    click(document.querySelector(".filter-clear")!);
    expect(apply).toHaveBeenLastCalledWith(""); expect(change).toHaveBeenLastCalledWith(EMPTY_ENTRY_FILTER);
    expect(document.querySelector(".filter-search-results")).toBeNull();
  });
});
