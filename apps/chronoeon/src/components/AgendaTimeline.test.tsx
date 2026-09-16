// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Entry } from "../domain/entry";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { AgendaTimeline } from "./AgendaTimeline";

let host: HTMLDivElement;
let root: Root;

function entry(id: string, title: string, date: string, kind: Entry["kind"] = "task"): Entry {
  return {
    id,
    kind,
    title,
    date,
    allDay: true,
    category: "work",
    color: "#77787b",
    createdAt: "2026-08-10T00:00:00Z",
  };
}

const shared = {
  locale: "en" as const,
  settings: DEFAULT_CHRONOEON_SETTINGS,
  filter: [],
  search: "",
  lunar: "never" as const,
  onToggle: () => undefined,
  onEdit: () => undefined,
  onNew: () => undefined,
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

describe("AgendaTimeline", () => {
  it("renders the shared vine timeline in compact mode", () => {
    act(() => {
      root.render(
        <AgendaTimeline
          {...shared}
          entries={[
            entry("00000000-0000-4000-8000-000000000001", "Buy milk", "2026-08-10"),
            entry("00000000-0000-4000-8000-000000000002", "Team lunch", "2026-08-10", "event"),
          ]}
          dayKeys={["2026-08-10"]}
          selectedKey="2026-08-10"
          mode="flat"
        />,
      );
    });
    expect(host.querySelector(".vine-timeline")).not.toBeNull();
    expect(host.querySelectorAll(".vine-item").length).toBe(2);
    // The mini window has its own date header; a day card here would repeat it.
    expect(host.querySelector(".list-day")).toBeNull();
  });

  it("shows the bilingual empty state in flat mode", () => {
    act(() => {
      root.render(
        <AgendaTimeline
          {...shared}
          locale="zh"
          entries={[]}
          dayKeys={["2026-08-10"]}
          selectedKey="2026-08-10"
          mode="flat"
        />,
      );
    });
    expect(host.querySelector(".compact-empty")).not.toBeNull();
    expect(host.textContent).toContain("今日尚有余白");
  });
});
