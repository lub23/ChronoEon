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
const catalogSettings = {
  ...DEFAULT_CHRONOEON_SETTINGS,
  calendars: [{
    ...DEFAULT_CHRONOEON_SETTINGS.calendars[0],
    categories: [{ id: "catalog-camp", name: "生活", color: "#90d7ec" }],
    defaultCategoryId: "catalog-camp",
  }],
};

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
  it("stacks a record's photos behind one frame and annotates it", () => {
    const requests: Array<{ items: string[]; index: number }> = [];
    const unsubscribe = subscribeImagePreview((request) => requests.push(request));
    act(() => {
      root.render(
        <PhotoWall
          locale="zh"
          settings={catalogSettings}
          days={["2026-08-10", "2026-08-11"]}
          groups={{
            "2026-08-10": [
              { id: "a", entry: entry({ id: "a", title: "露营", category: "catalog-camp", location: "西湖", note: "带上了新帐篷", images: [PHOTO, PHOTO_B, PHOTO] }), urls: [PHOTO, PHOTO_B] },
              { id: "b", entry: entry({ id: "b", title: "收据", kind: "bill", category: "Food/正餐", images: [PHOTO] }), urls: [PHOTO] },
            ],
          }}
        />,
      );
    });

    const frames = [...host.querySelectorAll<HTMLButtonElement>(".photo-wall-stack")];
    expect(frames).toHaveLength(2);
    expect(host.querySelectorAll(".photo-wall-day")).toHaveLength(1);
    expect(host.querySelectorAll(".photo-wall-item")).toHaveLength(2);
    // Two photos stack: the front sheet plus one tilted sheet behind it.
    expect(host.querySelectorAll(".photo-wall-item")[0]!.querySelectorAll(".photo-wall-sheet")).toHaveLength(2);
    expect(host.querySelectorAll(".photo-wall-item")[1]!.querySelectorAll(".photo-wall-sheet")).toHaveLength(1);
    const captions = [...host.querySelectorAll(".photo-wall-item")].map((item) => item.textContent);
    expect(captions[0]).toContain("露营");
    // Kind and category are dots before the title, so no words for them.
    expect(host.querySelectorAll(".photo-wall-item")[0]!.querySelector(".photo-wall-dot.is-event")).toBeTruthy();
    expect(host.querySelectorAll(".photo-wall-item")[0]!.querySelector(".photo-wall-dot.is-category")).toBeTruthy();
    // User-owned categories show their configured name, not their catalog ID.
    expect(host.querySelector(".photo-wall-dot.is-category")?.getAttribute("title")).toBe("生活");
    // Note before location, matching the day view's item.
    expect(captions[0]!.indexOf("带上了新帐篷")).toBeLessThan(captions[0]!.indexOf("西湖"));
    expect(captions[1]).toContain("收据");

    act(() => { frames[0].click(); });
    unsubscribe();
    expect(requests).toEqual([{ items: [PHOTO, PHOTO_B], index: 0 }]);
  });

  it("says so when the visible days carry no photos", () => {
    act(() => { root.render(<PhotoWall locale="en" settings={DEFAULT_CHRONOEON_SETTINGS} days={["2026-08-10"]} groups={{}} />); });
    expect(host.querySelector(".photo-wall-empty")?.textContent).toContain("No photos");
  });

  it("hides every item chip in the Day view and shows the day's photos", async () => {
    const items = [
      entry({ id: "a", title: "Standup", category: "Work", images: [PHOTO] }),
      entry({ id: "b", title: "Groceries", kind: "bill", amount: -20 }),
    ];
    await act(async () => {
      root.render(
        <DayView
          entries={items}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={catalogSettings}
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
    // The photo carries the record it belongs to, not just the image.
    expect(host.querySelector(".photo-wall-caption")?.textContent).toContain("Standup");
    expect(host.querySelector(".photo-wall-location")).toBeNull();
  });

  it("keeps the photo caption's location glyph the same size as its label", () => {
    act(() => {
      root.render(
        <PhotoWall
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={["2026-08-10"]}
          groups={{
            "2026-08-10": [{ id: "a", entry: entry({ id: "a", location: "西湖", images: [PHOTO] }), urls: [PHOTO] }],
          }}
        />,
      );
    });
    const glyph = host.querySelector<SVGSVGElement>(".photo-wall-location > svg")!;
    expect(glyph.getAttribute("width")).toBe("10");
    expect(glyph.getAttribute("height")).toBe("10");
  });
});
