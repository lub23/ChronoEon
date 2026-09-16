// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarSchedulePatch } from "@chronoeon/domain";
import type { Entry, EntryDraft } from "../domain/entry";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { DayView } from "./DayView";

let host: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 650, width: 900, height: 650, toJSON: () => ({}) } as DOMRectReadOnly;
    this.callback([{ target, contentRect: rect } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
}

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: "entry",
    kind: "event",
    title: "Entry",
    date: "2026-08-10",
    start: "09:00",
    end: "10:00",
    allDay: false,
    category: "general",
    color: "#90d7ec",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** jsdom has no layout: give the calendar elements explicit geometry. */
function mockGeometry() {
  const hourHeight = 64; // viewport 650, 15-minute density factor 1.14
  const canvasTop = 100;
  const setRect = (element: Element | null, rect: DOMRectReadOnly) => {
    if (element) element.getBoundingClientRect = () => rect;
  };
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ x: left, y: top, top, left, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRectReadOnly;

  const columns = host.querySelectorAll<HTMLElement>(".calendar-day-column[data-date]");
  columns.forEach((column, index) => setRect(column, rect(53 + index * 86, canvasTop, 86, 24 * hourHeight)));
  setRect(host.querySelector(".calendar-columns"), rect(53, canvasTop, 172, 24 * hourHeight));
  setRect(host.querySelector(".calendar-grid-canvas"), rect(0, canvasTop, 225, 24 * hourHeight));
  setRect(host.querySelector(".calendar-all-day-grid"), rect(0, 40, 225, 57));
  host.querySelectorAll<HTMLElement>(".calendar-all-day-cell[data-date]").forEach((cell, index) => {
    setRect(cell, rect(53 + index * 86, 40, 86, 57));
  });
  return { hourHeight, canvasTop };
}

function firePointer(type: string, target: EventTarget, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientX", { configurable: true, writable: true, value: x });
  Object.defineProperty(event, "clientY", { configurable: true, writable: true, value: y });
  Object.defineProperty(event, "button", { configurable: true, writable: true, value: 0 });
  Object.defineProperty(event, "pointerType", { configurable: true, writable: true, value: "mouse" });
  target.dispatchEvent(event);
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

describe("day view: drag to reschedule", () => {
  it("moves a timed entry to another day and time on release", async () => {
    const rescheduled: Array<{ id: string; patch: CalendarSchedulePatch }> = [];
    const item = entry({ id: "meeting", title: "Meeting" });
    act(() => {
      root.render(
        <DayView
          entries={[item]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={(entryArg, patch) => { rescheduled.push({ id: entryArg.id, patch }); }}
        />,
      );
    });
    const { hourHeight, canvasTop } = mockGeometry();
    const chip = host.querySelector(".item-chip--timed")!;
    expect(chip).toBeTruthy();

    // Grab the entry at 09:00 in the first column, drop at 14:00 in the second.
    const grabY = canvasTop + 9 * hourHeight;
    const dropY = canvasTop + 14 * hourHeight;
    await act(async () => {
      firePointer("pointerdown", chip, 96, grabY);
      firePointer("pointermove", window, 137, (grabY + dropY) / 2);
      firePointer("pointermove", window, 182, dropY);
      firePointer("pointerup", window, 182, dropY);
    });

    expect(rescheduled).toHaveLength(1);
    expect(rescheduled[0].id).toBe("meeting");
    expect(rescheduled[0].patch).toMatchObject({
      date: "2026-08-11",
      start: "14:00",
      end: "15:00",
      allDay: false,
    });
  });

  it("converts a timed entry to all-day when dropped in the all-day lane", async () => {
    const rescheduled: Array<{ id: string; patch: CalendarSchedulePatch }> = [];
    const item = entry({ id: "standup", title: "Standup" });
    act(() => {
      root.render(
        <DayView
          entries={[item]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={(entryArg, patch) => { rescheduled.push({ id: entryArg.id, patch }); }}
        />,
      );
    });
    const { canvasTop } = mockGeometry();
    const chip = host.querySelector(".item-chip--timed")!;

    await act(async () => {
      firePointer("pointerdown", chip, 96, canvasTop + 9 * 64);
      firePointer("pointermove", window, 182, 60); // inside the all-day lane, second column
      firePointer("pointerup", window, 182, 60);
    });

    expect(rescheduled).toHaveLength(1);
    expect(rescheduled[0].patch).toMatchObject({
      date: "2026-08-11",
      allDay: true,
    });
    expect(rescheduled[0].patch.start).toBeUndefined();
  });

  it("marks the origin with a dashed source and previews the landing with a light ghost mid-drag", async () => {
    const item = entry({ id: "ghost", title: "Ghost move" });
    act(() => {
      root.render(
        <DayView
          entries={[item]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={() => {}}
        />,
      );
    });
    const { canvasTop } = mockGeometry();
    const chip = host.querySelector(".item-chip--timed")!;

    // Grab in the first column and move across to the second, but do NOT
    // release — the visual must be inspectable mid-gesture.
    await act(async () => {
      firePointer("pointerdown", chip, 96, canvasTop + 9 * 64);
      firePointer("pointermove", window, 182, canvasTop + 14 * 64);
    });

    // The origin keeps a dashed, empty outline (fill/text cleared, pointer
    // events off) — the "where it came from" marker.
    const source = host.querySelector<HTMLElement>(".item-chip--timed.is-drag-source");
    expect(source).toBeTruthy();
    expect(source).toBe(chip);

    // A separate light ghost previews the snapped landing. It is a real item
    // placed inside the destination day column (so a cross-day move is never
    // clipped by the column's overflow:hidden).
    const ghost = host.querySelector<HTMLElement>(".item-chip.is-drag-ghost");
    expect(ghost).toBeTruthy();
    expect(ghost).not.toBe(chip);
    expect(ghost?.closest(".calendar-day-column")?.getAttribute("data-date")).toBe("2026-08-11");

    // Neither preview is interactive.
    expect(source?.style.pointerEvents).toBe("none");
    expect(ghost?.style.pointerEvents).toBe("none");

    await act(async () => {
      firePointer("pointerup", window, 182, canvasTop + 14 * 64);
    });
  });

  it("previews a resize-end edge on its source chip without spawning day ghosts", async () => {
    const item = entry({ id: "spanning", title: "Spanning resize" });
    act(() => {
      root.render(
        <DayView
          entries={[item]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={() => {}}
        />,
      );
    });
    const { canvasTop } = mockGeometry();
    const handle = host.querySelector(".calendar-resize-handle--end")!;

    await act(async () => {
      firePointer("pointerdown", handle, 96, canvasTop + 10 * 64);
      firePointer("pointermove", window, 96, canvasTop + 11 * 64);
    });

    const ghosts = [...host.querySelectorAll<HTMLElement>(".item-chip.is-drag-ghost")];
    expect(ghosts).toHaveLength(1);
    expect(host.querySelector(".item-chip.is-dragging")).toBeNull();
  });

  it("previews each civil day once while extending an overnight entry", async () => {
    const overnight = entry({
      id: "overnight-resize",
      title: "Overnight resize",
      start: "09:30",
      end: "08:00",
      endDate: "2026-08-11",
    });

    act(() => {
      root.render(
        <DayView
          entries={[overnight]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={() => {}}
        />,
      );
    });

    const { canvasTop } = mockGeometry();
    const handle = [...host.querySelectorAll<HTMLElement>(".calendar-resize-handle--end")][0]!;
    expect(handle).toBeTruthy();

    await act(async () => {
      firePointer("pointerdown", handle, 182, canvasTop);
      firePointer("pointermove", window, 182, canvasTop + 9 * 64);
    });

    const chips = [...host.querySelectorAll<HTMLElement>(".item-chip--timed")];
    const ghosts = chips.filter((chip) => chip.className.includes("is-drag-ghost"));
    expect(ghosts).toHaveLength(2);
    expect(ghosts.map((ghost) => ghost.closest(".calendar-day-column")?.getAttribute("data-date")))
      .toEqual(["2026-08-10", "2026-08-11"]);
    expect(chips.filter((chip) => chip.className.includes("is-dragging"))).toHaveLength(0);
  });

  it("previews both civil days while a resize-end edge crosses into tomorrow", async () => {
    const rescheduled: Array<CalendarSchedulePatch> = [];
    act(() => {
      root.render(
        <DayView
          entries={[entry({ id: "cross-end", date: "2026-08-10", start: "10:00", end: "11:00" })]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={(_entry, patch) => { rescheduled.push(patch); }}
        />,
      );
    });
    const { canvasTop, hourHeight } = mockGeometry();
    const handle = host.querySelector<HTMLElement>(".calendar-resize-handle--end")!;

    await act(async () => {
      firePointer("pointerdown", handle, 96, canvasTop + 10 * hourHeight);
      firePointer("pointermove", window, 182, canvasTop + 10 * hourHeight);
    });

    expect(rescheduled).toHaveLength(0);
    expect(host.querySelectorAll(".item-chip.is-dragging")).toHaveLength(0);
    const ghosts = [...host.querySelectorAll<HTMLElement>(".item-chip.is-drag-ghost")];
    expect(ghosts.map((ghost) => ghost.closest(".calendar-day-column")?.getAttribute("data-date")))
      .toEqual(["2026-08-10", "2026-08-11"]);
    expect(ghosts[0].style.top).toBe("640px");
    expect(ghosts[0].style.height).toBe("896px");
    expect(ghosts[1].style.top).toBe("0px");
    expect(ghosts[1].style.height).toBe("704px");

    await act(async () => {
      firePointer("pointerup", window, 182, canvasTop + 10 * hourHeight);
    });
    expect(rescheduled[0]).toMatchObject({
      date: "2026-08-10",
      start: "10:00",
      end: "11:00",
      endDate: "2026-08-11",
    });
  });

  it("resizes a start edge into a visible previous day and previews both segments", async () => {
    const rescheduled: Array<CalendarSchedulePatch> = [];
    act(() => {
      root.render(
        <DayView
          entries={[entry({ id: "cross-start", date: "2026-08-11", start: "10:00", end: "11:00" })]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={(_entry, patch) => { rescheduled.push(patch); }}
        />,
      );
    });
    const { canvasTop, hourHeight } = mockGeometry();
    const handle = host.querySelector<HTMLElement>(".calendar-resize-handle--start")!;

    await act(async () => {
      firePointer("pointerdown", handle, 182, canvasTop + 10 * hourHeight);
      firePointer("pointermove", window, 96, canvasTop + 10 * hourHeight);
    });

    const ghosts = [...host.querySelectorAll<HTMLElement>(".item-chip.is-drag-ghost")];
    expect(ghosts.map((ghost) => ghost.closest(".calendar-day-column")?.getAttribute("data-date")))
      .toEqual(["2026-08-10", "2026-08-11"]);
    expect(ghosts[0].style.top).toBe("640px");
    expect(ghosts[1].style.top).toBe("0px");

    await act(async () => {
      firePointer("pointerup", window, 96, canvasTop + 10 * hourHeight);
    });
    expect(rescheduled[0]).toMatchObject({
      date: "2026-08-10",
      start: "10:00",
      end: "11:00",
      endDate: "2026-08-11",
    });
  });

  it("removes the second-day ghost when an overnight resize shrinks below midnight", async () => {
    const rescheduled: Array<CalendarSchedulePatch> = [];
    act(() => {
      root.render(
        <DayView
          entries={[entry({
            id: "shrink",
            date: "2026-08-10",
            start: "09:30",
            end: "08:00",
            endDate: "2026-08-11",
          })]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={(_entry, patch) => { rescheduled.push(patch); }}
        />,
      );
    });
    const { canvasTop, hourHeight } = mockGeometry();
    const handle = [...host.querySelectorAll<HTMLElement>(".calendar-resize-handle--end")][0]!;

    await act(async () => {
      firePointer("pointerdown", handle, 182, canvasTop + 8 * hourHeight);
      firePointer("pointermove", window, 96, canvasTop + 12 * hourHeight);
    });

    const ghosts = [...host.querySelectorAll<HTMLElement>(".item-chip.is-drag-ghost")];
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].closest(".calendar-day-column")?.getAttribute("data-date")).toBe("2026-08-10");
    expect(ghosts[0].style.top).toBe("608px");

    await act(async () => {
      firePointer("pointerup", window, 96, canvasTop + 12 * hourHeight);
    });
    expect(rescheduled[0]).toMatchObject({
      date: "2026-08-10",
      start: "09:30",
      end: "12:00",
      endDate: undefined,
    });
  });

  it("does not leak a resize preview onto a day outside the new span", async () => {
    act(() => {
      root.render(
        <DayView
          entries={[entry({
            id: "two-day-preview",
            date: "2026-08-10",
            start: "03:30",
            end: "02:00",
            endDate: "2026-08-11",
          })]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={3}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={() => {}}
        />,
      );
    });
    const { canvasTop, hourHeight } = mockGeometry();
    const handle = [...host.querySelectorAll<HTMLElement>(".calendar-resize-handle--end")][0]!;

    await act(async () => {
      firePointer("pointerdown", handle, 182, canvasTop + 2 * hourHeight);
      firePointer("pointermove", window, 182, canvasTop + 20 * hourHeight);
    });

    const ghosts = [...host.querySelectorAll<HTMLElement>(".item-chip.is-drag-ghost")];
    expect(ghosts.map((ghost) => ghost.closest(".calendar-day-column")?.getAttribute("data-date")))
      .toEqual(["2026-08-10", "2026-08-11"]);
    expect(ghosts.some((ghost) => ghost.closest(".calendar-day-column")?.getAttribute("data-date") === "2026-08-12")).toBe(false);
  });

  it("renders both civil-day segments of a non-recurring overnight entry", () => {
    const overnight = entry({
      id: "overnight",
      title: "Overnight",
      start: "09:30",
      end: "08:00",
      endDate: "2026-08-11",
    });

    act(() => {
      root.render(
        <DayView
          entries={[overnight]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={() => {}}
        />,
      );
    });

    const chips = [...host.querySelectorAll<HTMLElement>(".item-chip--timed")];
    expect(chips).toHaveLength(2);
    expect(chips[0].style.top).toBe("608px");
    expect(chips[0].style.height).toBe("928px");
    expect(chips[1].closest(".calendar-day-column")?.getAttribute("data-date")).toBe("2026-08-11");
    expect(chips[1].style.top).toBe("0px");
    expect(chips[1].style.height).toBe("512px");
  });

  it("seeds a composer draft from a selection dragged across midnight", async () => {
    const drafts: Array<Partial<EntryDraft>> = [];
    act(() => {
      root.render(
        <DayView
          entries={[]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onNewAt={(draft) => drafts.push(draft)}
          onReschedule={() => {}}
        />,
      );
    });
    const { canvasTop } = mockGeometry();
    const firstColumn = host.querySelector<HTMLElement>(".calendar-day-column[data-date='2026-08-10']")!;

    await act(async () => {
      firePointer("pointerdown", firstColumn, 96, canvasTop + 23 * 64);
      firePointer("pointermove", window, 182, canvasTop + 1 * 64);
      firePointer("pointerup", window, 182, canvasTop + 1 * 64);
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      date: "2026-08-10",
      start: "23:00",
      end: "01:00",
      endDate: "2026-08-11",
      allDay: false,
    });
  });

  it("does not reschedule when the pointer never moves", async () => {
    const rescheduled: Array<{ id: string; patch: CalendarSchedulePatch }> = [];
    const item = entry({ id: "still", title: "Still" });
    act(() => {
      root.render(
        <DayView
          entries={[item]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={2}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={(entryArg, patch) => { rescheduled.push({ id: entryArg.id, patch }); }}
        />,
      );
    });
    const { canvasTop } = mockGeometry();
    const chip = host.querySelector(".item-chip--timed")!;

    await act(async () => {
      firePointer("pointerdown", chip, 96, canvasTop + 9 * 64);
      firePointer("pointerup", window, 96, canvasTop + 9 * 64);
    });

    expect(rescheduled).toHaveLength(0);
  });
});

describe("day view: grid presentation", () => {
  it("keeps every presentation on the hour grid", () => {
    act(() => {
      root.render(
        <DayView
          entries={[entry({ id: "timeline-entry" })]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={1}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          showPhotos={false}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={() => {}}
        />,
      );
    });

    expect(host.querySelector(".agenda-timeline")).toBeNull();
    expect(host.querySelector(".calendar-grid-canvas")).toBeTruthy();
    expect(host.querySelector(".day-view-heading")).toBeNull();
  });

  it("wires past-day fading to non-task items and open tasks", () => {
    act(() => {
      root.render(
        <DayView
          entries={[
            entry({ id: "past-meeting", title: "Past meeting" }),
            entry({ id: "past-task", title: "Still open", kind: "task", status: "open" }),
          ]}
          selectedDate={new Date(2026, 7, 10)}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          days={1}
          anchor="selection"
          filter={[]}
          search=""
          weekStartsOn={1}
          timeScale={15}
          showPhotos={false}
          onSelectDate={() => {}}
          onToggle={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onReschedule={() => {}}
        />,
      );
    });
    const meeting = [...host.querySelectorAll<HTMLElement>(".item-chip--timed")]
      .find((chip) => chip.textContent?.includes("Past meeting"))!;
    const task = [...host.querySelectorAll<HTMLElement>(".item-chip--timed")]
      .find((chip) => chip.textContent?.includes("Still open"))!;
    expect(meeting.className).toContain("is-past");
    expect(meeting.style.opacity).toBe("0.62");
    expect(task.className).toContain("is-past");
    expect(task.style.opacity).toBe("1");
  });
});
