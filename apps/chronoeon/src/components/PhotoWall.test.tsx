// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry, EntryDraft } from "../domain/entry";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { DayView } from "./DayView";
import { subscribeImagePreview } from "./photoPreviewBus";
import { PhotoWall } from "./PhotoWall";

let host: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
  observe() { /* no-op */ }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
}

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";
const PHOTO_B = "data:image/png;base64,iVBORw0KGgp=";

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: "entry",
    kind: "event",
    title: "Entry",
    date: "2026-08-10",
    allDay: true,
    category: "default",
    color: "#90d7ec",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
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

describe("photo appreciation", () => {
  it("lists each day's photos and opens the enlarged viewer on click", () => {
    const requests: Array<{ items: string[]; index: number }> = [];
    const unsubscribe = subscribeImagePreview((request) => requests.push(request));
    act(() => {
      root.render(
        <PhotoWall
          locale="zh"
          days={["2026-08-10", "2026-08-11"]}
          photos={{ "2026-08-10": [PHOTO, PHOTO_B] }}
        />,
      );
    });

    const frames = [...host.querySelectorAll<HTMLButtonElement>(".photo-wall-frame")];
    expect(frames).toHaveLength(2);
    expect(host.querySelectorAll(".photo-wall-day")).toHaveLength(1);

    act(() => { frames[1].click(); });
    unsubscribe();
    expect(requests).toEqual([{ items: [PHOTO, PHOTO_B], index: 1 }]);
  });

  it("says so when the visible days carry no photos", () => {
    act(() => { root.render(<PhotoWall locale="en" days={["2026-08-10"]} photos={{}} />); });
    expect(host.querySelector(".photo-wall-empty")?.textContent).toContain("No photos");
  });

  it("hides every item chip in the Day view and shows the day's photos", async () => {
    const items = [
      entry({ id: "a", title: "Standup", images: [PHOTO] }),
      entry({ id: "b", title: "Groceries", kind: "bill", amount: -20 }),
    ];
    await act(async () => {
      root.render(
        <DayView
          entries={items}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={1}
          anchor="selection"
          filter={[]}
          search=""
          photosOnly
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onNewAt={(_draft: Partial<EntryDraft>) => {}}
          onReschedule={() => {}}
        />,
      );
    });
    expect(host.querySelector(".item-chip")).toBeNull();
    expect(host.querySelector(".calendar-grid-canvas")).toBeNull();
    expect(host.querySelector(".photo-wall")).toBeTruthy();
  });
});
