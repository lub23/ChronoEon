// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../domain/entry";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { MonthView } from "./MonthView";

let host: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) } as DOMRectReadOnly;
    this.callback([{ target, contentRect: rect } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
}

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: "entry",
    kind: "event",
    title: "Entry",
    date: "2026-08-10",
    allDay: true,
    category: "general",
    color: "#90d7ec",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function renderMonth(entries: Entry[]) {
  act(() => {
    root.render(
      <MonthView
        entries={entries}
        selectedDate={new Date(2026, 7, 10)}
        locale="en"
        settings={DEFAULT_CHRONOEON_SETTINGS}
        filter={[]}
        search=""
        weekStartsOn={DEFAULT_CHRONOEON_SETTINGS.firstDay}
        onSelectDate={() => {}}
        onOpenAgenda={() => {}}
        onToggle={() => {}}
        onEdit={() => {}}
        onNewAt={() => {}}
        onReschedule={() => {}}
      />,
    );
  });
}

describe("month view: rendered item placement", () => {
  it("renders every single-day entry inside its own day cell", () => {
    const entries = [
      entry({ id: "a", title: "Alpha", date: "2026-08-05" }),
      entry({ id: "b", title: "Beta", date: "2026-08-19" }),
      entry({ id: "c", title: "Gamma", date: "2026-08-31" }),
    ];
    renderMonth(entries);
    for (const item of entries) {
      const chip = [...host.querySelectorAll(".item-chip--month")].find((node) => node.textContent?.includes(item.title));
      expect(chip, `chip for ${item.title}`).toBeTruthy();
      const cell = chip!.closest(".month-day[data-date]");
      expect(cell?.getAttribute("data-date")).toBe(item.date);
    }
  });

  it("renders a multi-day entry as one banner covering its first day's row", () => {
    const trip = entry({ id: "trip", title: "Trip", date: "2026-08-10", endDate: "2026-08-12" });
    renderMonth([trip]);
    const banners = host.querySelectorAll(".month-banner");
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain("Trip");
    // The banner must not also render as a per-day chip.
    const chips = [...host.querySelectorAll(".item-chip--month:not(.month-banner)")].filter((node) => node.textContent?.includes("Trip"));
    expect(chips).toHaveLength(0);
  });

  it("keeps chips of the same day on distinct vertical slots", () => {
    const day = "2026-08-10";
    const entries = Array.from({ length: 5 }, (_, index) =>
      entry({ id: `t${index}`, title: `Task ${index}`, date: day, start: `${String(8 + index).padStart(2, "0")}:00`, allDay: false }),
    );
    renderMonth(entries);
    const cell = host.querySelector(".month-day[data-date='2026-08-10']")!;
    const chips = [...cell.querySelectorAll(".item-chip--month")];
    const tops = chips.map((chip) => chip.getAttribute("style")?.match(/top:\s*(\d+)px/)?.[1]);
    // jsdom measures 110px cells -> 4 visible slots. Five items: the first three
    // chips take slots 0-2, the fourth slot is reserved for the overflow dot (so
    // it stays inside the cell instead of clipping below it), and the two chips
    // that would have taken slots 3 and 4 fold into that dot.
    expect(tops).toHaveLength(3);
    expect(new Set(tops).size).toBe(3);
    const more = cell.querySelector(".month-more");
    expect(more?.getAttribute("aria-label")).toContain("2");
    // The badge itself sits on the final visible row, not one row past it.
    expect(more?.getAttribute("style")?.match(/top:\s*(\d+)px/)?.[1]).toBe("57");
  });
});

describe("month view: recurrence and cross-day placement", () => {
  it("projects a daily recurrence once per day without duplicates", () => {
    const recurring = entry({
      id: "standup",
      title: "Standup",
      date: "2026-08-03",
      start: "09:00",
      end: "09:15",
      allDay: false,
      recurrence: "daily",
    });
    renderMonth([recurring]);
    const chips = [...host.querySelectorAll(".item-chip--month")].filter((node) => node.textContent?.includes("Standup"));
    // The 42-day grid runs Jul 27 - Sep 6; the series starts Aug 3.
    expect(chips.length).toBe(35);
    const dates = chips.map((chip) => chip.closest(".month-day[data-date]")?.getAttribute("data-date"));
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("keeps a cross-day timed entry out of the month banner lane", () => {
    const overnight = entry({
      id: "concert",
      title: "Concert",
      date: "2026-08-14",
      endDate: "2026-08-15",
      start: "20:00",
      end: "23:00",
      allDay: false,
    });
    renderMonth([overnight]);
    const chips = [...host.querySelectorAll(".item-chip--month")].filter((node) => node.textContent?.includes("Concert"));
    // A two-day span renders as a banner, not as two chips.
    expect(chips.some((chip) => chip.classList.contains("month-banner"))).toBe(true);
  });
});

describe("month view: banner offset follows the rendered head height", () => {
  it("positions a slot-0 banner at the measured head height, not a fixed 34px", () => {
    // The phone breakpoint shrinks .month-day-head to 26px via CSS; the layout
    // must track the rendered head so multi-day banners line up with the chips
    // that share their row (this was the 8px misalignment bug).
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const rect = original.call(this);
      if (this instanceof HTMLElement && this.classList.contains("month-day-head")) {
        return { ...rect, height: 26, top: 0, bottom: 26 } as DOMRect;
      }
      return rect;
    };
    try {
      const trip = entry({ id: "trip", title: "Trip", date: "2026-08-10", endDate: "2026-08-12" });
      renderMonth([trip]);
      const banner = host.querySelector(".month-banner")!;
      expect(banner).toBeTruthy();
      const marginTop = banner.getAttribute("style")?.match(/margin-top:\s*(\d+)px/)?.[1];
      // slot 0 banner sits exactly one measured head below the row top (26, not 34).
      expect(marginTop).toBe("26");
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});

describe("month view: the +N badge opens the day in place", () => {
  function busyDay(): Entry[] {
    return Array.from({ length: 6 }, (_, index) =>
      entry({ id: `t${index}`, title: `Task ${index}`, date: "2026-08-10", start: `${String(8 + index).padStart(2, "0")}:00`, allDay: false }),
    );
  }

  it("names itself for assistive tech and advertises the popover", () => {
    renderMonth(busyDay());
    const cell = host.querySelector(".month-day[data-date='2026-08-10']")!;
    const badge = cell.querySelector<HTMLButtonElement>(".month-more")!;
    // The badge's footprint (full slot width inside the cell padding, 17px tall,
    // centred) is a stylesheet concern that jsdom does not load; it is verified
    // in the browser, where badge x/width/height now equal the chips' exactly.
    expect(badge.getAttribute("aria-haspopup")).toBe("dialog");
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    // Previously the badge had neither a label nor a title: a screen reader
    // announced only "+3 button" with no day and no idea what it opened.
    expect(badge.getAttribute("aria-label")).toMatch(/Aug 10/);
    expect(badge.getAttribute("aria-label")).toMatch(/\d+ more/);
    // A count is encoded as at most three dots: 1/2/3+ are distinguishable
    // without spending narrow month width on a numeric pill.
    expect(badge.querySelectorAll(".month-more-dot")).toHaveLength(3);
  });

  it("opens only the hidden items without navigating away", () => {
    let openedAnotherView = false;
    act(() => {
      root.render(
        <MonthView
          entries={busyDay()}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          filter={[]}
          search=""
          weekStartsOn={DEFAULT_CHRONOEON_SETTINGS.firstDay}
          onSelectDate={() => {}}
          onOpenAgenda={() => { openedAnotherView = true; }}
          onToggle={() => {}}
          onEdit={() => {}}
          onNewAt={() => {}}
          onReschedule={() => {}}
        />,
      );
    });
    const badge = host.querySelector<HTMLButtonElement>(".month-day[data-date='2026-08-10'] .month-more")!;
    act(() => { badge.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });

    const peek = host.querySelector(".month-peek");
    expect(peek, "the badge must open a peek").toBeTruthy();
    // The month is still on screen; the click did not switch views.
    expect(host.querySelector(".month-grid")).toBeTruthy();
    expect(openedAnotherView).toBe(false);
    const visibleCount = host.querySelectorAll(".month-day[data-date='2026-08-10'] .item-chip--month").length;
    expect(peek!.querySelectorAll(".item-chip--month")).toHaveLength(6 - visibleCount);
    expect(peek!.getAttribute("role")).toBe("dialog");

    // Escape closes exactly the peek.
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(host.querySelector(".month-peek")).toBeNull();
    expect(host.querySelector(".month-grid")).toBeTruthy();
  });

  it("exposes day cells as a keyboard-reachable date grid", () => {
    renderMonth(busyDay());
    const grid = host.querySelector(".month-grid")!;
    expect(grid.getAttribute("role")).toBe("grid");
    const cells = [...host.querySelectorAll<HTMLElement>(".month-day[data-date]")];
    expect(cells).toHaveLength(42);
    expect(cells.every((cell) => cell.getAttribute("role") === "gridcell")).toBe(true);
    // Exactly one tab stop (the selected day), so Tab reaches the grid once and
    // the arrows move inside it.
    expect(cells.filter((cell) => cell.getAttribute("tabindex") === "0")).toHaveLength(1);
    const selected = cells.find((cell) => cell.getAttribute("tabindex") === "0")!;
    expect(selected.dataset.date).toBe("2026-08-10");
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.getAttribute("aria-label")).toMatch(/August 10, 2026/);
  });

  it("omits already-visible earlier cross-day events from the overflow popover", () => {
    renderMonth([...busyDay(), entry({ id: "trip", title: "Earlier trip", date: "2026-08-01", endDate: "2026-08-12" }),
      entry({ id: "past", title: "Finished trip", date: "2026-08-02", endDate: "2026-08-05" })]);
    const badge = host.querySelector<HTMLButtonElement>(".month-day[data-date='2026-08-10'] .month-more")!;
    act(() => badge.click());
    const peek = host.querySelector(".month-peek")!;
    expect(peek.textContent).not.toContain("Earlier trip");
    expect(peek.textContent).not.toContain("Finished trip");
    expect(peek.querySelectorAll(".item-chip").length).toBeGreaterThan(0);
  });

  it("keeps a trailing-month overflow anchored to its original grid until Open day", () => {
    const onSelectDate = vi.fn(), onOpenAgenda = vi.fn();
    const date = "2026-09-05";
    const entries = [
      entry({ id: "trip", title: "Visible prior trip", date: "2026-08-28", endDate: date }),
      entry({ id: "finished", title: "Finished earlier", date: "2026-08-10", endDate: "2026-08-20" }),
      ...Array.from({ length: 8 }, (_, i) => entry({ id: `tail-${i}`, title: `Tail item ${i}`, date })),
    ];
    act(() => root.render(<MonthView entries={entries} selectedDate={new Date(2026, 7, 10)} locale="en"
      settings={DEFAULT_CHRONOEON_SETTINGS} filter={[]} search="" onSelectDate={onSelectDate} onOpenAgenda={onOpenAgenda}
      onToggle={() => {}} onEdit={() => {}} onReschedule={() => {}} />));
    const badge = host.querySelector<HTMLButtonElement>(`.month-day[data-date="${date}"] .month-more`)!;
    act(() => badge.click());
    expect(onSelectDate).not.toHaveBeenCalled();
    expect(host.querySelector(".month-grid")?.getAttribute("aria-label")).toBe("August 2026");
    const peek = host.querySelector(".month-peek")!;
    expect(peek.textContent).not.toContain("Visible prior trip");
    expect(peek.textContent).not.toContain("Finished earlier");
    expect(peek.querySelectorAll(".item-chip").length).toBeGreaterThan(0);
    act(() => peek.querySelector<HTMLButtonElement>(".month-peek-actions button:last-child")!.click());
    expect(onSelectDate).toHaveBeenCalledWith(new Date(2026, 8, 5));
    expect(onOpenAgenda).toHaveBeenCalledTimes(1);
  });

  it("opens the same peek from the keyboard", () => {
    renderMonth(busyDay());
    const selected = host.querySelector<HTMLElement>(".month-day[data-date='2026-08-10']")!;
    act(() => { selected.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(host.querySelector(".month-peek")).toBeTruthy();
  });
});


describe("mobile lunar visibility", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["auto", "always"] as const)("shows lunar labels for Chinese mobile users with preference %s", (lunar) => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    act(() => root.render(<MonthView entries={[]} selectedDate={new Date(2026, 7, 10)} locale="zh"
      settings={DEFAULT_CHRONOEON_SETTINGS} filter={[]} search="" weekStartsOn={1} lunar={lunar}
      onSelectDate={() => {}} onOpenAgenda={() => {}} onToggle={() => {}} onEdit={() => {}} onNewAt={() => {}} onReschedule={() => {}} />));
    const labels = host.querySelectorAll(".month-day-head .day-lunar");
    expect(labels.length).toBeGreaterThanOrEqual(28);
    expect(labels[0].textContent).not.toBe("");
    expect(labels[0].getAttribute("title")).toBeTruthy();
  });
  it("still respects the explicit never preference on a phone", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    act(() => root.render(<MonthView entries={[]} selectedDate={new Date(2026, 7, 10)} locale="zh"
      settings={DEFAULT_CHRONOEON_SETTINGS} filter={[]} search="" weekStartsOn={1} lunar="never"
      onSelectDate={() => {}} onOpenAgenda={() => {}} onToggle={() => {}} onEdit={() => {}} onNewAt={() => {}} onReschedule={() => {}} />));
    expect(host.querySelector(".day-lunar")).toBeNull();
  });
});
