// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateBillStats, type Entry } from "@chronoeon/domain";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { StatsView } from "./StatsView";

let host: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function bill(id: string, category: string, amount: number): Entry {
  return {
    id,
    kind: "bill",
    title: id,
    date: "2026-09-01",
    category,
    amount,
    currency: "CNY",
    color: "#90d7ec",
    createdAt: "2026-09-01T00:00:00.000Z",
    source: "demo",
  };
}

function task(id: string, status: Entry["status"], date = "2026-09-01"): Entry {
  return {
    id,
    kind: "task",
    title: `Task ${id}`,
    date,
    start: "09:30",
    allDay: false,
    category: "work",
    color: "#3b82f6",
    status,
    createdAt: "2026-09-01T00:00:00.000Z",
    source: "demo",
  };
}

beforeEach(() => {
  localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

function chooseGranularity(label: string) {
  act(() => host.querySelector<HTMLButtonElement>(".review-granularity button")!.click());
  act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent === label)!.click());
}

describe("bill category split", () => {
  it("keeps the concise Insights title, date controls, and today marker", () => {
    act(() => {
      root.render(
        <StatsView
          entries={[bill("today-bill", "food/正餐", -120)]}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          today="2026-09-01"
        />,
      );
    });

    expect(host.querySelector(".stats-page .page-title-row h2")?.textContent).toContain("A calmer view");
    expect(host.querySelectorAll(".stats-custom-range .glass-date-picker")).toHaveLength(2);
    expect(host.querySelector(".heatmap-cell.is-today")?.getAttribute("aria-label")).toContain("2026-09-01");
  });

  it("renders actionable overdue/completed task rows with time and category colour", () => {
    const onToggle = vi.fn();
    act(() => {
      root.render(
        <StatsView
          entries={[task("old", "open", "2026-09-01"), task("today", "open", "2026-09-02"), task("done", "done", "2026-09-01")]}
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          today="2026-09-02"
          onToggle={onToggle}
        />,
      );
    });
    act(() => host.querySelectorAll<HTMLButtonElement>(".stats-tabs button")[1]?.click());

    const cards = [...host.querySelectorAll<HTMLElement>(".stats-card")];
    const overdue = cards.find((card) => card.querySelector("h3")?.textContent?.includes("遗留待办"))!;
    const completed = cards.find((card) => card.querySelector("h3")?.textContent?.includes("已完成"))!;
    expect(overdue.querySelector(".task-summary-row")?.textContent).toContain("9月1日 · 09:30");
    expect(overdue.querySelector(".task-summary-check")).toBeTruthy();
    expect(overdue.querySelector(".task-summary-dot")).toBeTruthy();
    expect(overdue.querySelector(".task-summary-divider")?.textContent).toContain("今日及之后");
    expect(overdue.querySelectorAll(".task-summary-row")).toHaveLength(2);
    expect(completed.querySelector(".task-summary-row")?.textContent).toContain("Task done");

    act(() => overdue.querySelector<HTMLButtonElement>(".task-summary-check")!.click());
    expect(onToggle).toHaveBeenCalledWith("old", expect.objectContaining({ id: "old" }));
  });

  it("connects segment centres to expanded subcategory names with dashed curves", () => {
    const entries = [
      bill("meal", "food/正餐", -500),
      bill("drink", "food/饮品", -300),
    ];
    const bills = aggregateBillStats(entries, { start: "2026-09-01", end: "2026-09-30" }, DEFAULT_CHRONOEON_SETTINGS);

    act(() => {
      root.render(
        <StatsView
          entries={entries}
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          today="2026-09-01"
        />,
      );
    });

    chooseGranularity("按日");
    expect(host.querySelector(".review-chart-line")).toBeTruthy();
    expect(host.querySelector("[data-testid='review-peak-dot']")).toBeTruthy();
    expect(host.querySelector("[data-testid='review-average-line-expenseTotal']")).toBeTruthy();
    expect(host.querySelector(".review-chart-average-label")?.textContent).toBe("￥26.67");

    act(() => {
      host.querySelector<HTMLElement>(".review-chart-hit")
        ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(host.querySelector(".review-chart-tooltip")?.textContent).toContain("2026年9月1日");

    act(() => {
      host.querySelector<HTMLButtonElement>(".stats-split-name-btn")?.click();
    });
    expect(document.querySelector(".stats-detail")).toBeTruthy();
    expect(document.querySelector(".stats-detail-backdrop")?.parentElement).toBe(document.body);
    expect(document.body.classList.contains("stats-detail-open")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')?.click();
    });
    expect(document.querySelector(".stats-detail")?.closest("[inert]")).not.toBeNull();
    expect(document.body.classList.contains("stats-detail-open")).toBe(false);
    expect(document.body.style.overflow).toBe("");

    act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="展开分类"]')?.click();
    });

    expect(host.querySelector(".stats-split-head .stats-split-bar")).toBeTruthy();
    expect(host.querySelectorAll(".stats-split-connectors path")).toHaveLength(2);
    expect(host.querySelector(".stats-split-connectors path")?.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("uses one evenly indexed daily tick scale for a year", async () => {
    act(() => {
      root.render(
        <StatsView
          entries={[bill("year-bill", "food/正餐", -120)]}
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          today="2026-09-01"
        />,
      );
    });

    act(() => {
      host.querySelectorAll<HTMLButtonElement>(".stats-range button")[6]?.click();
    });
    await act(async () => {});

    chooseGranularity("按日");
    const labels = [...host.querySelectorAll(".review-chart-label")]
      .map((label) => label.textContent)
      .filter(Boolean);
    expect(labels.length).toBeLessThanOrEqual(13);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.at(-1)).toBe("12/31");
  });
});


describe("remembered Insights selections", () => {
  const renderStats = (today = "2026-09-10") => act(() => root.render(<StatsView entries={[]} locale="en" settings={DEFAULT_CHRONOEON_SETTINGS} today={today} />));
  const revisit = (today?: string) => { act(() => root.render(null)); renderStats(today); };

  it("restores the tab, relative period, granularity and keyword after a view switch", () => {
    renderStats();
    act(() => host.querySelectorAll<HTMLButtonElement>(".stats-tabs button")[1].click());
    act(() => host.querySelectorAll<HTMLButtonElement>(".stats-range button")[3].click());
    act(() => host.querySelector<HTMLButtonElement>(".review-granularity button")!.click());
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent === "By month")!.click());
    const search = host.querySelector<HTMLInputElement>('.stats-keyword-input input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "project");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    revisit();
    expect(host.querySelectorAll(".stats-tabs button")[1].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelectorAll(".stats-range button")[3].classList.contains("is-active")).toBe(true);
    expect(host.querySelector(".review-granularity")?.textContent).toContain("By month");
    expect(host.querySelector<HTMLInputElement>(".stats-keyword-input input")?.value).toBe("project");
    expect(JSON.parse(localStorage.getItem("chronoeon.preference.stats-custom-range")!)).toBeNull();
    revisit("2026-10-10");
    expect(host.querySelectorAll(".stats-custom-range .glass-picker-value")[1].textContent).toBe("2026-10-10");
  });

  it("keeps exact custom dates, then clears them when a relative preset is selected", () => {
    renderStats();
    act(() => host.querySelector<HTMLButtonElement>(".stats-custom-range button")!.click());
    act(() => [...document.querySelectorAll<HTMLButtonElement>(".glass-date-cell:not(.is-outside)")].find(button => button.textContent === "3")!.click());
    revisit();
    expect([...host.querySelectorAll(".stats-custom-range .glass-picker-value")].map(el=>el.textContent)).toEqual(["2026-09-03", "2026-09-30"]);
    act(() => host.querySelectorAll<HTMLButtonElement>(".stats-range button")[0].click());
    revisit();
    expect(host.querySelectorAll(".stats-range button")[0].classList.contains("is-active")).toBe(true);
    expect(JSON.parse(localStorage.getItem("chronoeon.preference.stats-custom-range")!)).toBeNull();
  });
});

describe("weekly and selected category review curves", () => {
  const catalog = { ...DEFAULT_CHRONOEON_SETTINGS,
    bill: { ...DEFAULT_CHRONOEON_SETTINGS.bill, categories: [
      { id: "food", name: "Dining", color: "#aabbcc", direction: "expense" as const, sub: ["Meal", "Drink"] },
      { id: "income", name: "Income", color: "#ccddee", direction: "income" as const, sub: ["Salary"] },
    ] },
    calendars: DEFAULT_CHRONOEON_SETTINGS.calendars.map(calendar => ({ ...calendar, categories: [{ id: "work", name: "Work", color: "#448866" }] })),
  };
  function renderReview(locale: "en" | "zh" = "en") {
    act(() => root.render(<StatsView entries={[bill("meal", "food/正餐", 120), bill("salary", "income/Salary", 80), task("work", "open")]} locale={locale} settings={catalog} today="2026-09-12" />));
  }
  it.each([["2026-09-13", false], ["2026-09-14", true]] as const)("shows the weekly option only for at least two weeks (%s)", (end, weekly) => {
    localStorage.setItem("chronoeon.preference.stats-custom-range", JSON.stringify({ start: "2026-09-01", end }));
    renderReview();
    if (weekly) {
      expect(host.querySelector(".review-granularity")?.textContent).toContain("By week");
      expect(host.querySelectorAll(".review-chart-hit")).toHaveLength(3);
    } else expect(host.querySelector(".review-granularity")).toBeNull();
  });
  it("defaults each new range to its largest valid resolution", () => {
    renderReview(); expect(host.querySelector(".review-granularity")?.textContent).toContain("By week");
    act(() => host.querySelectorAll<HTMLButtonElement>(".stats-range button")[2].click());
    expect(host.querySelector(".review-granularity")?.textContent).toContain("By month");
    chooseGranularity("By day");
    act(() => host.querySelectorAll<HTMLButtonElement>(".stats-range button")[3].click());
    expect(host.querySelector(".review-granularity")?.textContent).toContain("By year");
    act(() => host.querySelectorAll<HTMLButtonElement>(".stats-range button")[0].click());
    expect(host.querySelector(".review-granularity")).toBeNull();
  });
  it("starts with Total and all primary categories, draws selected lines and only one average", () => {
    renderReview("zh");
    const trigger = host.querySelector<HTMLButtonElement>(".review-categories button")!;
    expect(host.querySelector(".review-categories")?.nextElementSibling?.classList.contains("review-granularity")).toBe(true);
    expect(host.querySelectorAll(".review-chart-average")).toHaveLength(2);
    expect([...host.querySelectorAll(".review-chart-average-label")].map(node => node.textContent).sort()).toEqual(["￥16", "￥24"]);
    // Totals stay dark whatever the theme's category palette says, so the line
    // carries no per-series colour and leans on its own `is-total` ink.
    const totalLine = host.querySelector<SVGPolylineElement>('.review-chart-line[data-series="total"]')!;
    expect(totalLine.getAttribute("class")).toContain("is-total");
    expect(totalLine.style.stroke).toBe("");
    const food = catalog.bill.categories.find(category => category.id === "food")!;
    expect(host.querySelector<SVGPolylineElement>('.review-chart-line[data-series="category:food"]')?.style.stroke).toBe(food.color);
    act(() => trigger.click());
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="listbox"][aria-multiselectable="true"] [role="option"]')];
    expect(options[0].textContent).toBe("总支出");
    expect(options.every(option => option.getAttribute("aria-selected") === "true")).toBe(true);
    expect(options.some(option => option.textContent?.includes("/"))).toBe(false);
    expect(host.querySelector('.review-chart-end-label[data-series="incomeTotal"]')?.textContent).toBe("总收入");
    const foodLabel = options.find(option => option.textContent === "Dining")!.textContent;
    act(() => options.find(option => option.textContent === foodLabel)!.click());
    expect(host.querySelector('.review-chart-line[data-series="category:food"]')).toBeNull();
    expect(host.querySelector('.review-chart-end-label[data-series="category:food"]')).toBeNull();
    act(() => options[0].click());
    expect(host.querySelector('.review-chart-line[data-series="total"]')).toBeNull();
    expect(host.querySelector('[data-testid="review-average-line-expenseTotal"]')).toBeNull();
    expect(host.querySelector('[data-testid="review-average-line-incomeTotal"]')).toBeTruthy();
    // Bill and schedule category selections are independent.
    act(() => host.querySelectorAll<HTMLButtonElement>(".stats-tabs button")[1].click());
    expect(host.querySelector('.review-chart-line[data-series="total"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="review-average-line-scheduleTotal"]')).toBeTruthy();
    expect(host.querySelector('.review-chart-line[data-series="category:work"]')).toBeTruthy();
    expect(host.querySelector('.review-chart-line[data-series="category:food"]')).toBeNull();
    act(() => host.querySelectorAll<HTMLButtonElement>(".stats-tabs button")[0].click());
    expect(host.querySelector('.review-chart-line[data-series="total"]')).toBeNull();
  });
});
