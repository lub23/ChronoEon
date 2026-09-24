// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagePreview } from "./ImagePreview";

let host: HTMLDivElement;
let root: Root;

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";
const PHOTO_B = "data:image/png;base64,iVBORw0KGgp=";
const PHOTO_C = "data:image/png;base64,iVBORw0KGgq=";

function pointer(type: string, target: Element, init: { pointerId?: number; clientX?: number; button?: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: "touch", button: 0, clientX: 0, clientY: 0, ...init });
  act(() => { target.dispatchEvent(event); });
}

async function render(items: string[], index: number, onIndexChange = vi.fn(), onClose = vi.fn()) {
  await act(async () => {
    root.render(<ImagePreview locale="zh" items={items} index={index} onIndexChange={onIndexChange} onClose={onClose} />);
    // Attachments resolve on a microtask; the slides paint once they land.
    await Promise.resolve();
  });
  return { onIndexChange, onClose };
}

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

describe("enlarged photo viewer", () => {
  it("needs a second photo before it offers the arrows or the film", async () => {
    await render([PHOTO], 0);
    expect(document.querySelectorAll(".image-preview-nav")).toHaveLength(0);
    expect(document.querySelectorAll(".image-preview-thumb")).toHaveLength(0);
    expect(document.querySelector(".image-preview-bar")?.textContent).toContain("照片预览");
  });

  it("shows one main photo plus the record's set along the bottom", async () => {
    await render([PHOTO, PHOTO_B, PHOTO_C], 1);
    expect(document.querySelectorAll(".image-preview-nav")).toHaveLength(2);
    expect(document.querySelector(".image-preview-main img")?.getAttribute("src")).toBe(PHOTO_B);
    expect([...document.querySelectorAll(".image-preview-thumb img")].map((thumb) => thumb.getAttribute("src")))
      .toEqual([PHOTO, PHOTO_B, PHOTO_C]);
    expect(document.querySelector(".image-preview-thumb.is-active")?.getAttribute("aria-label")).toBe("2 / 3");
    expect(document.querySelector(".image-preview-bar")?.textContent).toContain("2 / 3");
  });

  it("switches the main photo when a thumbnail is picked", async () => {
    const onIndexChange = vi.fn();
    await render([PHOTO, PHOTO_B, PHOTO_C], 0, onIndexChange, vi.fn());
    act(() => { document.querySelectorAll<HTMLButtonElement>(".image-preview-thumb")[2]!.click(); });
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it("closes on a single tap on the picture", async () => {
    const { onClose } = await render([PHOTO], 0);
    act(() => { document.querySelector<HTMLElement>(".image-preview-main")!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("slides to the next photo on a swipe and swallows the tap it leaves behind", async () => {
    const onIndexChange = vi.fn();
    const onClose = vi.fn();
    await render([PHOTO, PHOTO_B], 0, onIndexChange, onClose);
    const stage = document.querySelector<HTMLElement>(".image-preview-main")!;

    pointer("pointerdown", stage, { clientX: 200 });
    pointer("pointermove", stage, { clientX: 140 });
    pointer("pointerup", stage, { clientX: 140 });
    // The browser fires this after the finger lifts; it must not close the viewer.
    act(() => { document.querySelector<HTMLElement>(".image-preview-main")!.click(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("settles back without changing photos when the swipe was a nudge", async () => {
    const onIndexChange = vi.fn();
    await render([PHOTO, PHOTO_B], 0, onIndexChange, vi.fn());
    const stage = document.querySelector<HTMLElement>(".image-preview-main")!;

    pointer("pointerdown", stage, { clientX: 200 });
    pointer("pointermove", stage, { clientX: 185 });
    pointer("pointerup", stage, { clientX: 185 });

    expect(onIndexChange).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>(".image-preview-main")!.style.transform).toBe("translateX(0px)");
  });
});
