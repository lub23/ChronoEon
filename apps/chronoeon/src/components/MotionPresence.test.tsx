// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MotionPresence, createMotionPortal } from "./MotionPresence";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
function Surface() { return createMotionPortal(<div className="test-backdrop"><section role="dialog">hello</section></div>, document.body); }
it("retains a non-interactive portal for its exit animation, then unmounts it", () => {
  act(() => root.render(<MotionPresence><Surface /></MotionPresence>));
  expect(document.querySelector(".test-backdrop")?.getAttribute("data-motion-state")).toBe("open");
  act(() => root.render(<MotionPresence>{null}</MotionPresence>));
  expect(document.querySelector(".test-backdrop")?.getAttribute("data-motion-state")).toBe("closing");
  expect(document.querySelector(".test-backdrop")?.hasAttribute("inert")).toBe(true);
  act(() => vi.advanceTimersByTime(160));
  expect(document.querySelector(".test-backdrop")).toBeNull();
});
it("cancels an exit if a surface reopens", () => {
  act(() => root.render(<MotionPresence><Surface /></MotionPresence>));
  act(() => root.render(<MotionPresence>{null}</MotionPresence>));
  act(() => vi.advanceTimersByTime(80));
  act(() => root.render(<MotionPresence><Surface /></MotionPresence>));
  act(() => vi.advanceTimersByTime(200));
  expect(document.querySelector(".test-backdrop")?.getAttribute("data-motion-state")).toBe("open");
});
