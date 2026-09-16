// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { EntryRow } from "./EntryRow";

let host: HTMLDivElement;
let root: Root;

const entry = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "task" as const,
  title: "Draft the release notes",
  date: "2026-08-10",
  allDay: true,
  category: "work",
  color: "#77787b",
  createdAt: "2026-08-10T00:00:00Z",
  note: "Cover the storage pivot and the import tool.",
  tags: ["release"],
  priority: "high" as const,
};

function renderRow() {
  act(() => {
    root.render(
      <EntryRow
        entry={entry}
        locale="zh"
        settings={DEFAULT_CHRONOEON_SETTINGS}
        onToggle={() => undefined}
        onEdit={() => undefined}
      />,
    );
  });
  return host.querySelector("article") as HTMLElement;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("entry hover details card", () => {
  it("appears after the hover-intent delay and shows the hidden details", () => {
    const row = renderRow();
    act(() => row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(host.querySelector(".entry-hover-card")).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    const card = host.querySelector(".entry-hover-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Cover the storage pivot");
    expect(card!.textContent).toContain("#release");
    expect(card!.textContent).toContain("高"); // priorityHigh zh label
  });

  it("a quick pointer sweep never flashes the card", () => {
    const row = renderRow();
    act(() => row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(100));
    act(() => row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    act(() => vi.advanceTimersByTime(400));
    expect(host.querySelector(".entry-hover-card")).toBeNull();
  });

  it("hides again when the pointer leaves the row", () => {
    const row = renderRow();
    act(() => row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(400));
    expect(host.querySelector(".entry-hover-card")).not.toBeNull();
    act(() => row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(host.querySelector(".entry-hover-card")).toBeNull();
  });
});
