// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DueReminder, Entry } from "@chronoeon/domain";
import { ReminderDialog } from "./ReminderDialog";

let host: HTMLDivElement;
let root: Root;

function entry(id: string, title: string): Entry {
  return {
    id,
    kind: "event",
    title,
    date: "2026-09-04",
    start: "14:00",
    end: "15:00",
    allDay: false,
    category: "工作",
    color: "#f47920",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
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

describe("ReminderDialog", () => {
  it("lists every due reminder and opens the requested entry", async () => {
    const reminders: DueReminder[] = [
      { entry: entry("one", "Project review"), key: "one", triggerAt: new Date("2026-09-04T13:45:00") },
      { entry: entry("two", "Lunch"), key: "two", triggerAt: new Date("2026-09-04T11:30:00") },
    ];
    let opened: string | null = null;
    let closed = false;
    act(() => {
      root.render(
        <ReminderDialog
          reminders={reminders}
          locale="zh"
          onClose={() => { closed = true; }}
          onOpen={(value) => { opened = value.id; }}
        />,
      );
    });
    expect(document.getElementById("reminder-title")?.textContent).toBe("时元提醒");
    expect(document.querySelectorAll(".reminder-sheet li")).toHaveLength(2);
    expect(document.querySelector(".reminder-sheet li")?.textContent).toContain("Project review");

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".reminder-sheet li button")!.click();
    });
    expect(opened).toBe("one");
    expect(closed).toBe(false);

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".reminder-sheet > footer button")!.click();
    });
    expect(closed).toBe(true);
  });
});
