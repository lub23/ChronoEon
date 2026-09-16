// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHRONOEON_SETTINGS, type AppView } from "../domain/entry";
import { useSwipeNavigation } from "../hooks/useSwipeNavigation";
import { clearChipDrag, isChipDragActive } from "./dragGesture";
import { DayView } from "./DayView";

let host: HTMLDivElement; let root: Root;
const create = vi.fn();
function Harness() {
  const [view, setView] = useState<AppView>("day");
  const [date, setDate] = useState(new Date(2026, 8, 12));
  const nav = useSwipeNavigation({ enabled: true, activeView: view, selectedDate: date, onDateChange: setDate,
    menuOpen: false, onMenuChange: () => {}, onViewChange: setView });
  return <div ref={nav.pagerRef} className="view-pager" data-view={view}>
    <DayView entries={[]} selectedDate={date} locale="en" settings={DEFAULT_CHRONOEON_SETTINGS}
      days={1} anchor="selection" filter={[]} search="" showPhotos={false} onSelectDate={setDate}
      onToggle={() => {}} onEdit={() => {}} onNew={create} onNewAt={create} onReschedule={() => {}} />
    {nav.preview && <div className="preview" data-view={nav.preview.view} />}
  </div>;
}
function point(type: string, x: number, y = 400) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerType: "touch", pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
  act(() => host.querySelector(".calendar-day-column")!.dispatchEvent(event));
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); create.mockReset(); clearChipDrag();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(<Harness />));
  const pager = host.querySelector(".view-pager")!;
  Object.defineProperties(pager, { clientWidth: { value: 390 }, clientHeight: { value: 600 } });
  host.querySelector<HTMLElement>(".calendar-day-column")!.getBoundingClientRect = () =>
    ({ left: 40, top: 0, width: 350, height: 1536, right: 390, bottom: 1536, x: 40, y: 0, toJSON() {} });
});
afterEach(() => { act(() => root.unmount()); host.remove(); clearChipDrag(); vi.useRealTimers(); });
describe("empty calendar slot gesture ownership", () => {
  it("pages when pointermove arrives before touchmove, without opening the composer", () => {
    point("pointerdown", 300); point("pointermove", 295);
    expect(host.querySelector(".calendar-time-selection")).toBeNull();
    point("pointermove", 180);
    expect(host.querySelector(".preview")?.getAttribute("data-view")).toBe("week");
    expect(host.querySelector(".calendar-time-selection")).toBeNull();
    point("pointerup", 180); act(() => vi.advanceTimersByTime(400));
    expect(host.querySelector(".view-pager")?.getAttribute("data-view")).toBe("week");
    expect(create).not.toHaveBeenCalled(); expect(isChipDragActive()).toBe(false);
  });
  it("lets a deliberate long press own the range instead of also changing views", () => {
    point("pointerdown", 280); act(() => vi.advanceTimersByTime(350));
    expect(isChipDragActive()).toBe(true);
    expect(host.querySelector(".calendar-time-selection")).not.toBeNull();
    point("pointermove", 150, 480); point("pointerup", 150, 480);
    act(() => vi.advanceTimersByTime(400));
    expect(host.querySelector(".view-pager")?.getAttribute("data-view")).toBe("day");
    expect(create).toHaveBeenCalledTimes(1); expect(isChipDragActive()).toBe(false);
  });
  it("does not create a range on a vertical scroll or a cancelled touch", () => {
    point("pointerdown", 280); point("pointermove", 282, 520); point("pointercancel", 282, 520);
    act(() => vi.advanceTimersByTime(500));
    expect(host.querySelector(".calendar-time-selection")).toBeNull();
    expect(host.querySelector(".preview")).toBeNull(); expect(create).not.toHaveBeenCalled();
  });
});
