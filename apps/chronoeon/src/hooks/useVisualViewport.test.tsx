// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisualViewport } from "./useVisualViewport";
let host: HTMLDivElement; let root: Root;
function Harness() { useVisualViewport(); return null; }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("capture visual viewport", () => {
  it("tracks keyboard height and panned offsets without subtracting the inset twice", () => {
    const viewport = Object.assign(new EventTarget(), { height: 844, width: 390, offsetTop: 0, offsetLeft: 0 });
    vi.stubGlobal("visualViewport", viewport);
    act(() => root.render(<Harness />));
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--visual-viewport-height")).toBe("844px");
    viewport.height = 390; viewport.offsetTop = 64;
    act(() => { viewport.dispatchEvent(new Event("resize")); viewport.dispatchEvent(new Event("scroll")); vi.advanceTimersByTime(20); });
    expect(style.getPropertyValue("--visual-viewport-height")).toBe("390px");
    expect(style.getPropertyValue("--visual-viewport-top")).toBe("64px");
    viewport.height = 844; viewport.offsetTop = 0;
    act(() => { viewport.dispatchEvent(new Event("resize")); vi.advanceTimersByTime(20); });
    expect(style.getPropertyValue("--visual-viewport-top")).toBe("0px");
    expect(style.getPropertyValue("--visual-viewport-height")).toBe("844px");
  });
  it("uses the layout rectangle when the native WebView itself is resized", () => {
    vi.stubGlobal("visualViewport", undefined);
    act(() => root.render(<Harness />));
    expect(document.documentElement.style.getPropertyValue("--visual-viewport-height")).toBe(window.innerHeight + "px");
    act(() => root.render(null));
    expect(document.documentElement.style.getPropertyValue("--visual-viewport-height")).toBe("");
  });
});
