// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../domain/entry";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { PhotoWallView } from "./PhotoWallView";

let host: HTMLDivElement;
let root: Root;

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";

/** jsdom has no IntersectionObserver; record the observers so the test can trip them. */
class ObserverStub {
  static all: ObserverStub[] = [];
  elements: Element[] = [];
  constructor(private callback: IntersectionObserverCallback) { ObserverStub.all.push(this); }
  observe(element: Element) { this.elements.push(element); }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
  takeRecords() { return []; }
  trip(element: Element) {
    this.callback([{ target: element, isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: "entry",
    kind: "event",
    title: "Entry",
    date: "2026-07-12",
    allDay: true,
    category: "general",
    color: "#90d7ec",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).IntersectionObserver = ObserverStub;
  ObserverStub.all = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("paged photo wall", () => {
  it("keeps the wall bounded until a sentinel asks for another page", async () => {
    const older = entry({ id: "older", title: "去年露营", date: "2026-07-12", images: [PHOTO] });
    await act(async () => {
      root.render(
        <PhotoWallView entries={[older]} selectedDate={new Date(2026, 7, 10)} days={7} paged locale="zh" settings={DEFAULT_CHRONOEON_SETTINGS} />,
      );
      await Promise.resolve();
    });
    // 2026-07-12 sits a month before the selection, outside the opening window.
    expect(host.querySelectorAll(".photo-wall-day")).toHaveLength(0);
    expect(host.querySelector(".photo-wall-empty")).toBeTruthy();

    const observer = ObserverStub.all.at(-1)!;
    const top = host.querySelector<HTMLElement>(".photo-wall-sentinel")!;
    await act(async () => { observer.trip(top); await Promise.resolve(); });

    expect(host.querySelectorAll(".photo-wall-day")).toHaveLength(1);
    expect(host.querySelector(".photo-wall-caption")?.textContent).toContain("去年露营");
  });

  it("shows a fixed window when it is not paged", async () => {
    await act(async () => {
      root.render(
        <PhotoWallView entries={[entry({ id: "a", date: "2026-08-11", images: [PHOTO] })]} selectedDate={new Date(2026, 7, 10)} days={3} locale="zh" settings={DEFAULT_CHRONOEON_SETTINGS} />,
      );
      await Promise.resolve();
    });
    expect(host.querySelectorAll(".photo-wall-sentinel")).toHaveLength(0);
    expect(host.querySelectorAll(".photo-wall-day")).toHaveLength(1);
  });
});

it("grows the window in both directions", async () => {
  // One page back reaches 2026-06-29; one page forward reaches 2026-10-18.
  const before = entry({ id: "before", date: "2026-06-30", images: [PHOTO] });
  const after = entry({ id: "after", date: "2026-10-10", images: [PHOTO] });
  await act(async () => {
    root.render(<PhotoWallView entries={[before, after]} selectedDate={new Date(2026, 7, 10)} days={7} paged locale="zh" settings={DEFAULT_CHRONOEON_SETTINGS} />);
    await Promise.resolve();
  });
  expect(host.querySelectorAll(".photo-wall-day")).toHaveLength(0);
  const observers = [...ObserverStub.all];
  const sentinels = [...host.querySelectorAll<HTMLElement>(".photo-wall-sentinel")];
  await act(async () => { observers.at(-1)!.trip(sentinels[0]); await Promise.resolve(); });
  expect(host.querySelectorAll(".photo-wall-day")).toHaveLength(1);
  await act(async () => { [...ObserverStub.all].at(-1)!.trip(sentinels[1]); await Promise.resolve(); });
  expect(host.querySelectorAll(".photo-wall-day")).toHaveLength(2);
});
