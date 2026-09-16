// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewDock } from "./ViewDock";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props: Partial<Parameters<typeof ViewDock>[0]> = {}) {
  const handlers = {
    onViewChange: vi.fn(),
    onDayCountChange: vi.fn(),
    onTimer: vi.fn(),
    onQuickNote: vi.fn(),
  };
  act(() => {
    root.render(
      <ViewDock
        locale="zh"
        activeView="agenda"
        dayCount={1}
        {...handlers}
        {...props}
      />,
    );
  });
  return handlers;
}

describe("ViewDock", () => {
  it("keeps day/week in the range menu and month immediately to its right", () => {
    const handlers = render({ activeView: "day", dayCount: 3 });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".view-dock-views > button, .view-dock-day-group > button")];
    // List, day/week, month, quick note, ideas, insights.
    expect(buttons).toHaveLength(6);

    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="日视图 · 3"]')!.click(); });
    const menu = host.querySelector<HTMLElement>(".view-dock-days-menu")!;
    expect(menu).toBeTruthy();
    expect(menu.querySelectorAll('[role="menuitemradio"]')).toHaveLength(7);
    expect([...menu.querySelectorAll("button")].map((button) => button.textContent?.trim()))
      .toEqual(["1 天", "2 天", "3 天", "4 天", "5 天", "6 天", "周视图"]);

    act(() => { [...menu.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("周视图"))!.click(); });
    expect(handlers.onViewChange).toHaveBeenCalledWith("week");

    const month = host.querySelector<HTMLButtonElement>('[aria-label="月历"]')!;
    expect(host.querySelector(".view-dock-day-group")?.nextElementSibling).toBe(month);
    act(() => month.click());
    expect(handlers.onViewChange).toHaveBeenCalledWith("month");
  });

  it("restores the last calendar choice from a non-calendar view", () => {
    const handlers = render({ activeView: "agenda", calendarView: "week" });
    const calendarButton = host.querySelector<HTMLButtonElement>('[aria-label="周视图"]')!;
    expect(calendarButton).toBeTruthy();
    expect(calendarButton.className).not.toContain("is-active");

    act(() => { calendarButton.click(); });
    expect(handlers.onViewChange).toHaveBeenCalledWith("week");
  });

  it("keeps the quick-note button beside Ideas and opens on click", () => {
    const handlers = render();
    const quickNote = host.querySelector<HTMLButtonElement>(".view-dock-quicknote")!;
    expect(quickNote).toBeTruthy();
    expect(quickNote.getAttribute("aria-label")).toBe("随心记");
    expect(quickNote.querySelector(".quick-note-glyph")).toBeTruthy();
    expect(quickNote.querySelector(".quick-note-halo")).toBeNull();
    expect(quickNote.querySelector(".quick-note-plus")?.getAttribute("d")).toBe("M16 6v20M6 16h20");
    expect(host.querySelector(".view-dock-new")).toBeNull();
    expect(quickNote.querySelector(".quick-note-ai-sparkle")).toBeNull();
    expect(quickNote.querySelector(".quick-note-glyph")?.getAttribute("fill")).toBe("none");
    // It sits directly before the Ideas button.
    expect(quickNote.nextElementSibling?.getAttribute("aria-label")).toBe("灵感");

    act(() => quickNote.click());
    expect(handlers.onQuickNote).toHaveBeenCalledTimes(1);
  });

  it("opens from a native/screen-reader click without pointer events", () => {
    const handlers = render();
    act(() => host.querySelector<HTMLButtonElement>(".view-dock-quicknote")!.click());
    expect(handlers.onQuickNote).toHaveBeenCalledTimes(1);
  });

  it("mini keeps the list, day, quick note, ideas, timer and restore actions only", () => {
    const onRestore = vi.fn();
    render({ mini: true, onRestore, activeView: "day", dayCount: 2, filterControl: <button aria-label="筛选条目" /> });
    expect(host.querySelector("nav > button")?.getAttribute("aria-label")).toBe("筛选条目");
    expect(host.querySelector('[aria-label="月历"]')).toBeNull();
    expect(host.querySelector(".view-dock")?.classList.contains("is-mini")).toBe(true);
    expect(host.querySelector('[aria-label="统计"]')).toBeNull();
    expect(host.querySelector('[aria-label="灵感"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="还原"]')).toBeTruthy();

    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="日视图 · 2"]')!.click(); });
    const menu = host.querySelector<HTMLElement>(".view-dock-days-menu")!;
    expect([...menu.querySelectorAll("button")].map((button) => button.textContent?.trim()))
      .toEqual(["1 天", "2 天", "3 天"]);

    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="还原"]')!.click(); });
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
