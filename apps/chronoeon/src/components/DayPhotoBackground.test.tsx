// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DayPhotoBackground } from "./DayPhotoBackground";
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
describe("local photo crossfade", () => {
  it("keeps the current photo opaque until the incoming photo decodes, then promotes that same node", async () => {
    const renderParent = vi.fn();
    function Parent() { renderParent(); return <DayPhotoBackground images={["/one.jpg", "/two.jpg", "/three.jpg"]} intervalMs={1000} />; }
    act(() => root.render(<Parent />));
    const initial = host.querySelector<HTMLImageElement>(".is-current")!;
    expect(host.querySelectorAll("img")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1250));
    const incoming = host.querySelector<HTMLImageElement>(".is-incoming")!;
    expect(incoming).toBeTruthy(); expect(host.querySelectorAll("img")).toHaveLength(2);
    expect(host.querySelector(".is-current")).toBe(initial); expect(incoming.classList.contains("is-ready")).toBe(false);
    let decoded!: () => void;
    incoming.decode = vi.fn(() => new Promise<void>(resolve => { decoded = resolve; }));
    await act(async () => incoming.dispatchEvent(new Event("load")));
    expect(incoming.classList.contains("is-ready")).toBe(false);
    await act(async () => decoded()); act(() => vi.advanceTimersByTime(40));
    expect(incoming.classList.contains("is-ready")).toBe(true);
    expect(host.querySelector(".is-current")).toBe(initial);
    act(() => vi.advanceTimersByTime(1250));
    expect(host.querySelector(".is-current")).toBe(initial);
    expect(host.querySelector(".is-current")?.getAttribute("src")).toBe("/two.jpg");
    expect(incoming.classList.contains("is-standby")).toBe(true);
    expect(host.querySelectorAll("img")).toHaveLength(2); expect(renderParent).toHaveBeenCalledTimes(1);
  });
  it("does not rotate a single photo or start a fade while the document is hidden", () => {
    act(() => root.render(<DayPhotoBackground images={["/one.jpg"]} intervalMs={1000} />));
    act(() => vi.advanceTimersByTime(5000)); expect(host.querySelectorAll("img")).toHaveLength(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => root.render(<DayPhotoBackground images={["/one.jpg", "/two.jpg"]} intervalMs={1000} />));
    act(() => vi.advanceTimersByTime(5000)); expect(host.querySelectorAll("img")).toHaveLength(2);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(1250)); expect(host.querySelectorAll("img")).toHaveLength(2);
  });
});
