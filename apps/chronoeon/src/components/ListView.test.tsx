// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../domain/entry";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { ListView } from "./ListView";

let host: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    // Virtuoso waits for the measured viewport before rendering; report a
    // plausible desktop viewport immediately.
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRectReadOnly;
    this.callback([{ target, contentRect: rect } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
}

function entry(id: string, title: string, date: string, kind: Entry["kind"] = "task"): Entry {
  return {
    id,
    kind,
    title,
    date,
    allDay: true,
    category: "work",
    color: "#77787b",
    createdAt: "2026-08-10T00:00:00Z",
  };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  Element.prototype.scrollTo = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("virtualized list view", () => {
  /** Virtuoso renders on the next animation frame after measuring. */
  async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  }

  it("renders the selected week's day headers and entries through Virtuoso", async () => {
    const entries = [
      entry("00000000-0000-4000-8000-000000000001", "Buy milk", "2026-08-10"),
      entry("00000000-0000-4000-8000-000000000002", "Ship the build", "2026-08-10"),
      entry("00000000-0000-4000-8000-000000000003", "Team lunch", "2026-08-11", "event"),
      entry("00000000-0000-4000-8000-000000000004", "Read a chapter", "2026-08-12"),
    ];
    act(() => {
      root.render(
        <ListView
          entries={entries}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          filter={[]}
          search=""
          lunar="never"

          onToggle={() => undefined}
          onEdit={() => undefined}
          onNew={() => undefined}
        />,
      );
    });
    await flush();
    expect(host.textContent).toContain("Buy milk");
    expect(host.textContent).toContain("Team lunch");
    // The week group header carries the ISO week badge.
    expect(host.querySelector(".list-week-header")).not.toBeNull();
    expect(host.querySelector(".list-day.is-selected")).not.toBeNull();
    expect(host.querySelector(".vine-timeline")).not.toBeNull();
    expect(host.querySelector(".list-view-toolbar")).toBeNull();
  });

  it("shows the bilingual empty state when nothing matches", async () => {
    act(() => {
      root.render(
        <ListView
          entries={[]}
          selectedDate={new Date(2026, 7, 10)}
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          filter={[]}
          search=""
          lunar="never"

          onToggle={() => undefined}
          onEdit={() => undefined}
          onNew={() => undefined}
        />,
      );
    });
    await flush();
    // The selected day always renders, with its "open day" empty state.
    expect(host.querySelector(".list-day-empty")).not.toBeNull();
    expect(host.textContent).toContain("今日尚有余白");
  });

  it("keeps the selected empty day in the virtualized sequence", async () => {
    act(() => {
      root.render(
        <ListView
          entries={[entry("00000000-0000-4000-8000-000000000001", "Neighbor", "2026-08-11")]}
          selectedDate={new Date(2026, 7, 10)}
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          filter={[]}
          search=""
          lunar="never"
          onToggle={() => undefined}
          onEdit={() => undefined}
          onNew={() => undefined}
        />,
      );
    });
    await flush();

    const selected = host.querySelector<HTMLElement>(".list-day.is-selected");
    expect(selected?.dataset.date).toBe("2026-08-10");
    expect(selected?.textContent).toContain("今日尚有余白");
    expect(host.querySelectorAll(".list-day").length).toBeGreaterThan(1);
  });

  it("shows the floating return-to-today affordance while today is offscreen", async () => {
    act(() => {
      root.render(
        <ListView
          entries={[entry("00000000-0000-4000-8000-000000000001", "Away", "2026-08-10")]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          filter={[]}
          search=""
          lunar="never"
          onToggle={() => undefined}
          onEdit={() => undefined}
          onNew={() => undefined}
        />,
      );
    });
    await flush();

    const todayButton = host.querySelector<HTMLButtonElement>(".list-today-fab");
    expect(todayButton?.textContent).toBe("Today ↩");
    act(() => { todayButton?.click(); });
  });

  it("hides the floating Today affordance when today is the selection", async () => {
    const today = new Date();
    act(() => {
      root.render(
        <ListView
          entries={[]}
          selectedDate={today}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          filter={[]}
          search=""
          lunar="never"

          onToggle={() => undefined}
          onEdit={() => undefined}
          onNew={() => undefined}
        />,
      );
    });
    await flush();
    expect(host.querySelector(".list-view-toolbar")).toBeNull();
    expect(host.querySelector(".list-today-fab")).toBeNull();
  });
});
