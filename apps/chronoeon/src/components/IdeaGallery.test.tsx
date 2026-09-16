// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaGallery } from "./IdeaGallery";
import { subscribeImagePreview } from "./photoPreviewBus";

let host: HTMLDivElement;
let root: Root;
let observedWidth = 200;

class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) { this.callback = callback; }
  observe(target: Element) {
    const rect = { x: 0, y: 0, top: 0, left: 0, right: observedWidth, bottom: 56, width: observedWidth, height: 56, toJSON: () => ({}) } as DOMRectReadOnly;
    this.callback([{ target, contentRect: rect } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
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

const images = ["attachments/a.webp", "attachments/b.webp", "attachments/c.webp", "attachments/d.webp", "attachments/e.webp"];
const shown = () => [...host.querySelectorAll<HTMLLIElement>(".idea-gallery li")].map((item) => item.dataset.reference);

describe("IdeaGallery", () => {
  it("shows one centred row and pages through the rest as a loop", async () => {
    observedWidth = 200;
    await act(async () => { root.render(<IdeaGallery images={images} locale="zh" />); });
    expect(shown()).toEqual(["attachments/a.webp", "attachments/b.webp"]);
    const [prev, next] = [...host.querySelectorAll<HTMLButtonElement>(".idea-gallery-nav")];
    expect(prev.textContent).toBe("‹");
    expect(next.textContent).toBe("›");
    await act(async () => { next.click(); });
    expect(shown()).toEqual(["attachments/b.webp", "attachments/c.webp"]);
    await act(async () => { prev.click(); prev.click(); });
    expect(shown()).toEqual(["attachments/e.webp", "attachments/a.webp"]);
  });

  it("hides the arrows when every photo fits", async () => {
    observedWidth = 800;
    await act(async () => { root.render(<IdeaGallery images={images.slice(0, 3)} locale="zh" />); });
    expect(shown()).toHaveLength(3);
    expect(host.querySelector(".idea-gallery-nav")).toBeNull();
  });

  it("opens the enlarged preview from a thumbnail", async () => {
    observedWidth = 800;
    const requests: Array<{ items: string[]; index: number }> = [];
    const unsubscribe = subscribeImagePreview((request) => requests.push(request));
    await act(async () => { root.render(<IdeaGallery images={images.slice(0, 2)} locale="zh" />); });
    act(() => { host.querySelectorAll<HTMLButtonElement>(".idea-gallery li button")[1].click(); });
    unsubscribe();
    expect(requests).toEqual([{ items: images.slice(0, 2), index: 1 }]);
  });
});
