// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHRONOEON_SETTINGS, type Entry } from "@chronoeon/domain";
import { TaskSummaryList, TaskSummaryPopover } from "./TaskSummaryList";

let host: HTMLDivElement;
let root: Root;

const task: Entry = {
  id: "task-1",
  kind: "task",
  title: "Write report",
  date: "2026-09-08",
  start: "09:30",
  allDay: false,
  category: "work",
  color: "#3b82f6",
  status: "open",
  createdAt: "2026-09-08T00:00:00.000Z",
};

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

describe("task summary rows", () => {
  it("shows time, status control, title, and category colour", () => {
    const toggle = vi.fn();
    act(() => {
      root.render(
        <TaskSummaryList
          entries={[task]}
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          emptyLabel="none"
          onToggle={toggle}
          onOpen={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain("9月8日 · 09:30");
    expect(host.textContent).toContain("Write report");
    expect(host.querySelector(".task-summary-dot")).toBeTruthy();
    act(() => host.querySelector<HTMLButtonElement>(".task-summary-check")!.click());
    expect(toggle).toHaveBeenCalledWith("task-1", task);
  });

  it("opens the overdue list from its count", () => {
    act(() => {
      root.render(
        <TaskSummaryPopover
          label="遗留待办"
          count={1}
          entries={[task]}
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          emptyLabel="没有遗留待办"
          onToggle={vi.fn()}
          onOpen={vi.fn()}
        />,
      );
    });

    act(() => host.querySelector<HTMLButtonElement>(".hero-stat--button")!.click());
    expect(host.querySelector(".task-summary-menu")).toBeTruthy();
    expect(host.querySelectorAll(".task-summary-row")).toHaveLength(1);
  });

  it("separates overdue rows from today/upcoming rows inside the popover", () => {
    const old = { ...task, id: "old", date: "2026-09-07" };
    act(() => {
      root.render(
        <TaskSummaryPopover
          label="遗留待办"
          count={2}
          entries={[old]}
          upcomingEntries={[task]}
          upcomingLabel="今日及之后"
          upcomingEmptyLabel="暂无即将要做的事项"
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          emptyLabel="没有遗留待办"
          onToggle={vi.fn()}
          onOpen={vi.fn()}
        />,
      );
    });
    act(() => host.querySelector<HTMLButtonElement>(".hero-stat--button")!.click());
    expect(host.querySelector(".task-summary-divider")?.textContent).toContain("今日及之后");
    expect(host.querySelectorAll(".task-summary-row")).toHaveLength(2);
  });

  it("shows the recurrence cadence on a collapsed series row", () => {
    const habit = { ...task, recurrence: "daily" as const };
    act(() => {
      root.render(
        <TaskSummaryList
          entries={[habit]}
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          emptyLabel="none"
          onToggle={vi.fn()}
          onOpen={vi.fn()}
        />,
      );
    });
    expect(host.querySelector(".task-summary-repeat")?.textContent).toContain("每天");
  });

  it("groups repeated occurrences into one row with a count", () => {
    const occurrences: Entry[] = [
      { ...task, id: "series::recurrence::2026-09-08", recurrenceSourceId: "series", occurrenceDate: "2026-09-08" },
      { ...task, id: "series::recurrence::2026-09-15", recurrenceSourceId: "series", occurrenceDate: "2026-09-15", date: "2026-09-15" },
    ];
    act(() => {
      root.render(
        <TaskSummaryList
          entries={occurrences}
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          emptyLabel="none"
          onToggle={vi.fn()}
          onOpen={vi.fn()}
        />,
      );
    });
    expect(host.querySelectorAll(".task-summary-row")).toHaveLength(1);
    expect(host.querySelector(".task-summary-repeat")?.textContent).toContain("2");
  });

  it("opens the full status menu from the status control context menu", () => {
    const onStatus = vi.fn();
    act(() => {
      root.render(
        <TaskSummaryList
          entries={[task]}
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          emptyLabel="none"
          onToggle={vi.fn()}
          onStatus={onStatus}
          onOpen={vi.fn()}
        />,
      );
    });
    act(() => {
      host.querySelector<HTMLButtonElement>(".task-summary-check")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    });
    expect(document.querySelector(".task-status-menu")).toBeTruthy();
    act(() => document.querySelectorAll<HTMLButtonElement>(".task-status-menu button")[3]!.click());
    expect(onStatus).toHaveBeenCalledWith(task, "cancelled");
  });
});
