// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewLineChart, spreadEndLabels } from "./ReviewLineChart";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("keeps coincident endpoint labels ordered, legible and bounded", () => {
  const placed = [...spreadEndLabels(Array.from({ length: 10 }, (_, index) => ({ key: String(index), y: 170 })), 20, 190).values()];
  expect(placed[0]).toBeGreaterThanOrEqual(20); expect(placed.at(-1)).toBeLessThanOrEqual(190);
  expect(placed.every((value, index) => !index || value - placed[index - 1] >= 14)).toBe(true);
});
it("draws selected series and separate expense/income averages", () => {
  const open = vi.fn();
  act(() => root.render(<ReviewLineChart buckets={[{ date: "2026-09-07" }, { date: "2026-09-14" }]} labels={["9/7", "9/14"]}
    series={[{ key: "total", label: "Total expenses", color: "var(--accent)", values: [50, 25], total: true, average: "expenseTotal" },
      { key: "incomeTotal", label: "Total income", color: "var(--green)", values: [100, 50], average: "incomeTotal" },
      { key: "food", label: "Food", color: "#112233", values: [-50, -25] }]}
    ariaLabel="Cash flow" granularity="week" locale="en" formatValue={String} onOpenDate={open} />));
  expect(host.querySelectorAll(".review-chart-line")).toHaveLength(3);
  expect(host.querySelectorAll(".review-chart-end-label")).toHaveLength(3);
  expect(host.querySelectorAll(".review-chart-average")).toHaveLength(2);
  expect(host.querySelector('[data-testid="review-average-line-expenseTotal"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="review-average-line-incomeTotal"]')).toBeTruthy();
  expect([...host.querySelectorAll(".review-chart-average-label")].map(node => node.textContent).sort()).toEqual(["37.5", "75"]);
  const first = host.querySelector<HTMLButtonElement>(".review-chart-hit")!;
  expect(first.getAttribute("aria-label")).toContain("Sep");
  act(() => first.click()); expect(open).toHaveBeenCalledWith("2026-09-07");
  expect(host.querySelector(".review-chart-tooltip")?.textContent).toContain("Food");
});

it("highlights one category on a line, and only highlights from its name", () => {
  const buckets = Array.from({ length: 3 }, (_, index) => ({ date: `2026-09-${String(7 + index * 7).padStart(2, "0")}` }));
  act(() => root.render(<ReviewLineChart buckets={buckets} labels={["9/7", "9/14", "9/21"]}
    series={[{ key: "total", label: "Total expenses", color: "#0f5c6b", values: [50, 25, 60], total: true },
      { key: "food", label: "Food", color: "#112233", values: [-50, -25, -60] },
      { key: "travel", label: "Travel", color: "#445566", values: [-10, -5, -12] }]}
    ariaLabel="Cash flow" granularity="week" locale="en" formatValue={String} />));

  const foodHit = host.querySelector<SVGPolylineElement>('.review-chart-hitline[data-series="food"]')!;
  act(() => { foodHit.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
  expect(host.querySelector('.review-chart-line[data-series="food"]')?.getAttribute("class")).toContain("is-active");
  expect(host.querySelector('.review-chart-line[data-series="travel"]')?.getAttribute("class")).toContain("is-muted");
  // The totals stay readable whatever is selected.
  expect(host.querySelector('.review-chart-end-label[data-series="total"]')?.getAttribute("class")).toContain("is-total");

  // Pointing at the line reads only that category's value at that x.
  act(() => {
    foodHit.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 100 }));
  });
  const tooltip = host.querySelector(".review-chart-tooltip")!;
  expect(tooltip.textContent).toContain("Food");
  expect(tooltip.textContent).not.toContain("Travel");

  // A tap has no hover, so tapping the line both pins and reads the value.
  act(() => {
    foodHit.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100 }));
  });
  expect(host.querySelector(".review-chart-tooltip")).not.toBeNull();

  // Pointing at the right-hand name highlights without answering a value.
  act(() => { host.querySelector<HTMLElement>('.review-chart-end-label[data-series="travel"]')!.click(); });
  act(() => { host.querySelector<HTMLElement>('.review-chart-end-label[data-series="travel"]')!
    .dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
  expect(host.querySelector('.review-chart-end-label[data-series="travel"]')?.getAttribute("class")).toContain("is-active");
  expect(host.querySelector(".review-chart-tooltip")).toBeNull();
});
