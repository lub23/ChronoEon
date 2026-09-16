// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppView } from "../domain/entry";
import { useSwipeNavigation } from "./useSwipeNavigation";
let host: HTMLDivElement; let root: Root;
function Harness({ initial = "day" }: { initial?: AppView }) {
  const [view, setView] = useState<AppView>(initial); const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date(2026, 8, 12));
  const nav = useSwipeNavigation({ enabled: true, selectedDate: date, onDateChange: setDate, activeView: view, menuOpen: open, onViewChange: setView, onMenuChange: setOpen });
  return <><div ref={nav.sidebarRef} data-open={open} data-side={nav.sidebarSide} /><div ref={nav.backdropRef} />
    <div ref={nav.pagerRef} data-view={view} data-month={date.getMonth() + 1} data-axis={nav.preview?.axis ?? "x"} className="view-pager">
      <div className="scroller" style={{ overflowX: "auto" }}><div className="touch-target" /></div>
      {nav.preview && <div className="preview" data-view={nav.preview.view} data-month={nav.preview.date.getMonth() + 1} />}
    </div><button className="open-menu" onClick={nav.openSidebar} /><button className="choose-month" onClick={() => nav.selectView("month")} /><button className="choose-ideas" onClick={() => nav.selectView("ideas")} /></>;
}
function point(type: string, x: number, y = 100) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: y });
  act(() => host.querySelector(".touch-target")!.dispatchEvent(event));
}
function begin(x = 250) { point("pointerdown", x); }
function end(x: number, type = "pointerup") { point(type, x); act(() => vi.advanceTimersByTime(250)); }
function setup(initial: AppView = "day", scroll = false) {
  act(() => root.render(<Harness initial={initial} />));
  const pager = host.querySelector<HTMLElement>(".view-pager")!;
  Object.defineProperties(pager, { clientWidth: { value: 360 }, clientHeight: { value: 600 } });
  if (scroll) {
    const scroller = host.querySelector<HTMLElement>(".scroller")!;
    Object.defineProperties(scroller, { clientWidth: { value: 300 }, scrollWidth: { value: 600 } });
    return scroller;
  }
  return pager;
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
describe("interactive mobile navigation", () => {
  it("moves both view surfaces before release and only commits after settling", () => {
    const pager = setup(); begin(); point("pointermove", 150);
    expect(pager.style.getPropertyValue("--page-offset")).toBe("-100px");
    expect(host.querySelector(".preview")?.getAttribute("data-view")).toBe("week");
    expect(pager.dataset.view).toBe("day");
    point("pointerup", 150); expect(pager.dataset.view).toBe("day");
    act(() => vi.advanceTimersByTime(250)); expect(pager.dataset.view).toBe("week");
    expect(host.querySelector(".preview")).toBeNull();
    expect(pager.classList.contains("is-swiping")).toBe(false);
  });
  it("captures the pointer and suppresses native scrolling after a page locks", () => {
    const pager = setup();
    const target = host.querySelector<HTMLElement & { setPointerCapture?: (id: number) => void }>(".touch-target")!;
    const capture = vi.fn(); target.setPointerCapture = capture;
    begin(); point("pointermove", 150);
    expect(capture).toHaveBeenCalledWith(1);
    const touchMove = new Event("touchmove", { bubbles: true, cancelable: true });
    act(() => document.dispatchEvent(touchMove));
    expect(touchMove.defaultPrevented).toBe(true);
    end(150);
    expect(pager.dataset.view).toBe("week");
  });
  it("scrolls a wide calendar first and switches only on the next outward gesture", () => {
    const scroller = setup("day", true);
    scroller.scrollLeft = 220;
    begin(); point("pointermove", 120); end(120);
    expect(scroller.scrollLeft).toBe(300);
    expect(host.querySelector(".view-pager")?.getAttribute("data-view")).toBe("day");
    begin(); point("pointermove", 120); end(120);
    expect(host.querySelector(".view-pager")?.getAttribute("data-view")).toBe("week");
  });
  it("switches from the wide calendar header without requiring a trip to its scroll edge", () => {
    const scroller = setup("day", true); scroller.scrollLeft = 100;
    host.querySelector(".touch-target")!.setAttribute("data-view-swipe", "");
    begin(); point("pointermove", 170); end(170);
    expect(scroller.scrollLeft).toBe(100);
    expect(host.querySelector(".view-pager")?.getAttribute("data-view")).toBe("week");
  });
  it("scrolls back into the calendar instead of leaving from the wrong edge", () => {
    const scroller = setup("day", true); scroller.scrollLeft = 300;
    begin(100); point("pointermove", 230); end(230);
    expect(scroller.scrollLeft).toBe(170);
    expect(host.querySelector(".preview")).toBeNull();
  });
  it("accepts swipes starting on day-header and empty-cell buttons, without firing their tap", () => {
    const pager = setup(); const target = host.querySelector(".touch-target")!;
    const button = document.createElement("button"); button.className = "touch-target"; target.replaceWith(button);
    const tap = vi.fn(); button.addEventListener("click", tap);
    begin(); point("pointermove", 182); end(182);
    act(() => button.click());
    expect(pager.dataset.view).toBe("week"); expect(tap).not.toHaveBeenCalled();
  });
  it("suppresses the release click even after holding a moved finger still", () => {
    const pager = setup();
    const target = host.querySelector(".touch-target")!;
    const button = document.createElement("button"); button.className = "touch-target"; target.replaceWith(button);
    const tap = vi.fn(); button.addEventListener("click", tap);
    begin(); point("pointermove", 170); act(() => vi.advanceTimersByTime(600)); point("pointerup", 170);
    act(() => button.click()); act(() => vi.advanceTimersByTime(250));
    expect(tap).not.toHaveBeenCalled(); expect(pager.dataset.view).toBe("week");
  });
  it("honors the latest rapid dock selection instead of dropping taps", () => {
    const pager = setup();
    act(() => host.querySelector<HTMLButtonElement>(".choose-month")!.click());
    act(() => vi.advanceTimersByTime(40));
    act(() => host.querySelector<HTMLButtonElement>(".choose-ideas")!.click());
    act(() => vi.advanceTimersByTime(250));
    expect(pager.dataset.view).toBe("month");
    act(() => vi.advanceTimersByTime(300));
    expect(pager.dataset.view).toBe("ideas"); expect(host.querySelector(".preview")).toBeNull();
  });
  it("lets opening the menu cancel an unfinished dock transition without a late page commit", () => {
    const pager = setup();
    act(() => host.querySelector<HTMLButtonElement>(".choose-month")!.click());
    act(() => vi.advanceTimersByTime(40));
    act(() => host.querySelector<HTMLButtonElement>(".open-menu")!.click());
    act(() => vi.advanceTimersByTime(300));
    expect(pager.dataset.view).toBe("day"); expect(host.querySelector(".preview")).toBeNull();
    expect(host.querySelector("[data-open]")?.getAttribute("data-open")).toBe("true");
  });
  it("runs a queued selection after a cancelled swipe", () => {
    const pager = setup(); begin(); point("pointermove", 200); point("pointercancel", 200);
    act(() => host.querySelector<HTMLButtonElement>(".choose-month")!.click());
    act(() => vi.advanceTimersByTime(250)); act(() => vi.advanceTimersByTime(300));
    expect(pager.dataset.view).toBe("month");
  });
  it("cancels rather than committing on pointercancel", () => {
    const pager = setup(); begin(); point("pointermove", 90); end(90, "pointercancel");
    expect(pager.dataset.view).toBe("day"); expect(host.querySelector(".preview")).toBeNull();
  });
  it("allows navigation over an accessible item body", () => {
    const pager = setup();
    const item = host.querySelector(".touch-target")!;
    item.classList.add("item-chip"); item.setAttribute("role", "button");
    begin(); point("pointermove", 100); end(100);
    expect(pager.dataset.view).toBe("week");
  });
  it("snaps back when the finger reverses past the start", () => {
    const pager = setup(); begin(); point("pointermove", 100); point("pointermove", 300); end(300);
    expect(pager.dataset.view).toBe("day"); expect(host.querySelector(".preview")).toBeNull();
  });
  it("cancels an in-progress drag on viewport resize", () => {
    const pager = setup(); begin(); point("pointermove", 100);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(pager.classList.contains("is-swiping")).toBe(false);
    expect(host.querySelector(".preview")).toBeNull();
    end(100); expect(pager.dataset.view).toBe("day");
  });
  it.each([[250, 100, "10"], [100, 260, "8"]] as const)("progressively pages months vertically (%s → %s)", (from, to, month) => {
    const pager = setup("month");
    point("pointerdown", 160, from); point("pointermove", 160, to);
    expect(pager.dataset.axis).toBe("y");
    expect(pager.dataset.month).toBe("9");
    expect(pager.style.getPropertyValue("--page-offset")).toBe(`${to - from}px`);
    expect(host.querySelector(".preview")?.getAttribute("data-month")).toBe(month);
    point("pointerup", 160, to);
    expect(pager.dataset.month).toBe("9");
    act(() => vi.advanceTimersByTime(250));
    expect(pager.dataset.month).toBe(month); expect(pager.dataset.view).toBe("month");
    expect(host.querySelector(".preview")).toBeNull();
    expect(pager.style.getPropertyValue("--page-offset")).toBe("");
  });
  it("cancels vertical month paging without changing the date or leaving an offset", () => {
    const pager = setup("month");
    point("pointerdown", 160, 250); point("pointermove", 160, 100); point("pointercancel", 160, 100);
    act(() => vi.advanceTimersByTime(250));
    expect(pager.dataset.month).toBe("9"); expect(host.querySelector(".preview")).toBeNull();
    expect(pager.style.getPropertyValue("--page-offset")).toBe("");
  });
  it("leaves vertical scrolling native", () => {
    const pager = setup(); begin(); point("pointermove", 245, 200); end(240);
    expect(pager.dataset.view).toBe("day"); expect(pager.style.getPropertyValue("--page-offset")).toBe("");
  });
  it.each([["agenda", 80, 230, "left"], ["insights", 250, 90, "right"]] as const)("opens the drawer at the %s boundary", (view, from, to, side) => {
    setup(view); begin(from); point("pointermove", to);
    expect(host.querySelector("[data-side]")?.getAttribute("data-side")).toBe(side);
    expect((host.querySelector("[data-side]") as HTMLElement).style.transform).toContain("translate3d");
    end(to); expect(host.querySelector("[data-open]")?.getAttribute("data-open")).toBe("true");
  });
});
