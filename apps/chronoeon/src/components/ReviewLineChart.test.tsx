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
