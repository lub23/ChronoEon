// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DEFAULT_CHRONOEON_SETTINGS as settings, type Entry } from "@chronoeon/domain";
import { StatsHeatmap } from "./StatsHeatmap";
let root: Root, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const bill = (date: string, amount = -20): Entry => ({ id: date, kind: "bill", title: date, color: "#123456", date, amount, category: "food", createdAt: date + "T00:00:00Z" });
const options = [{ key: "total", label: "Total expense", color: "red" }, { key: "incomeTotal", label: "Total income", color: "#2f8f5b" }];
function render(end = "2025-05-23", tab: "bills" | "tasks" = "bills") {
 const entries = tab === "bills" ? [bill("2025-02-14"), bill("2025-02-15"), bill("2025-05-23"), bill("2025-05-24"), bill("2026-01-31"), bill("2026-02-01")] : [{ ...bill("2025-02-15"), kind: "task" as const }];
 act(() => root.render(<StatsHeatmap entries={entries} range={{ start: "2025-02-15", end }} settings={settings} locale="en" today="2025-02-15" tab={tab} options={options} onOpenDate={vi.fn()} />));
}
function cell(date: string) { return host.querySelector<HTMLButtonElement>(`button[aria-label^="${date} ·"]`)!; }
it("shows exactly twelve months from the start month and clips color to the selected dates", () => {
 render();
 expect(host.querySelectorAll("button.heatmap-cell:not(.is-outside)")).toHaveLength(365);
 expect(cell("2025-02-01").classList.contains("is-outside")).toBe(false);
 expect(cell("2026-01-31").classList.contains("is-outside")).toBe(false);
 expect(cell("2025-02-14").classList.contains("heat-0")).toBe(true);
 expect(cell("2025-02-15").classList.contains("is-in-range")).toBe(true);
 expect(cell("2025-05-23").classList.contains("heat-4")).toBe(true);
 expect(cell("2025-05-24").classList.contains("is-in-range")).toBe(false);
 expect(cell("2026-01-31").classList.contains("heat-0")).toBe(true);
 expect(cell("2025-02-15").style.background).toContain("var(--accent)");
 expect(host.textContent).not.toContain("Year total");
});
it("caps a later end date at the twelfth month end", () => { render("2027-01-01"); expect(cell("2026-01-31").classList.contains("heat-4")).toBe(true); expect(cell("2026-02-01").classList.contains("is-outside")).toBe(true); });
it("shows schedule counts with the same date window", () => { render(undefined, "tasks"); expect(cell("2025-02-15").getAttribute("aria-label")).toContain("1"); expect(cell("2025-02-15").classList.contains("heat-4")).toBe(true); });

it("uses green for selected income", () => {
 localStorage.setItem("chronoeon.preference.stats-heatmap-category", JSON.stringify({ bills: "incomeTotal" }));
 act(() => root.render(<StatsHeatmap entries={[{ ...bill("2025-02-15", 40), category: settings.calendars[0].billCategories.find(category => category.direction === "income")!.id }]} range={{ start: "2025-02-15", end: "2025-05-23" }} settings={settings} locale="en" today="2025-02-15" tab="bills" options={options} />));
 expect(cell("2025-02-15").style.background).toContain("#2f8f5b");
 expect(host.querySelector<HTMLElement>(".heatmap-legend .heat-4")!.style.background).toContain("#2f8f5b");
});

it("uses the selected category color", () => {
 const id = settings.calendars[0].billCategories.find(category => category.direction === "expense")!.id;
 localStorage.setItem("chronoeon.preference.stats-heatmap-category", JSON.stringify({ bills: "category:" + id }));
 act(() => root.render(<StatsHeatmap entries={[{ ...bill("2025-02-15"), category: id }]} range={{ start: "2025-02-15", end: "2025-05-23" }} settings={settings} locale="en" today="2025-02-15" tab="bills" options={[...options, { key: "category:" + id, label: "Category", color: "#123456" }]} />));
 expect(cell("2025-02-15").style.background).toContain("#123456");
 expect(host.querySelector<HTMLElement>(".heatmap-legend .heat-4")!.style.background).toContain("#123456");
});
