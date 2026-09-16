// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHRONOEON_SETTINGS, type Entry } from "../domain/entry";
import { ItemChip } from "./ItemChip";

let host: HTMLDivElement;
let root: Root;

const entry: Entry = {
  id: "timed",
  kind: "event",
  title: "Design review",
  date: "2026-08-28",
  start: "14:00",
  end: "15:00",
  allDay: false,
  category: "work",
  color: "#77787b",
  createdAt: "2026-08-01T00:00:00.000Z",
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

describe("ItemChip compact month label", () => {
  it("keeps the time prefix where there is room", () => {
    act(() => {
      root.render(<ItemChip entry={entry} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="month" />);
    });
    expect(host.querySelector(".item-chip-title")?.textContent).toBe("14:00 Design review");
  });

  it("hides a timed chip's exact times when painted at title-only height", () => {
    act(() => {
      root.render(<ItemChip entry={entry} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="timed" compactLabel />);
    });
    expect(host.querySelector(".item-chip-title")?.textContent).toBe("Design review");
    expect(host.querySelector(".item-chip-time")).toBeNull();
    expect(host.querySelector(".item-chip")?.getAttribute("aria-label")).toContain("14:00-15:00(1h)");
  });

  it("drops the redundant HH:MM prefix on phone-width month cells", () => {
    act(() => {
      root.render(<ItemChip entry={entry} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="month" compactLabel />);
    });
    expect(host.querySelector(".item-chip-title")?.textContent).toBe("Design review");
    // The full time remains available to assistive technology and hover.
    expect(host.querySelector(".item-chip")?.getAttribute("aria-label")).toContain("14:00-15:00(1h)");
  });

  it("shows bill direction and magnitude, uses currency icon, and preserves the full title for a CSS edge fade", () => {
    const bill: Entry = { ...entry, id: "bill", kind: "bill", amount: -100, currency: "USD", title: "Very long coffee purchase" };
    act(() => {
      root.render(<ItemChip entry={bill} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="month" compactLabel />);
    });
    expect(host.querySelector(".item-chip-glyph svg")).toBeTruthy();
    expect(host.querySelector(".item-chip-amount")?.textContent).toBe("Expense-100");
    expect(host.querySelector(".item-chip-title")?.textContent).toBe("Very long coffee purchase");
  });

  it("reveals timed note and location only when the painted height has enough lines", () => {
    const detailed = { ...entry, note: "Bring the printed brief", location: "Room 8" };
    act(() => {
      root.render(<ItemChip entry={detailed} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="timed" detailLines={2} />);
    });
    expect(host.querySelector(".item-chip-time")?.textContent).toContain("14:00");
    expect(host.querySelector(".item-chip-note")).toBeNull();
    expect(host.querySelector(".item-chip-location")).toBeNull();

    act(() => {
      root.render(<ItemChip entry={detailed} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="timed" detailLines={3} />);
    });
    expect(host.querySelector(".item-chip-note")?.textContent).toBe("Bring the printed brief");
    expect(host.querySelector(".item-chip-location")).toBeNull();

    act(() => {
      root.render(<ItemChip entry={detailed} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="timed" detailLines={4} />);
    });
    expect(host.querySelector(".item-chip-location")?.textContent).toBe("Room 8");
  });

  it("fades past work like finished work but keeps unfinished tasks active", () => {
    const pastEvent = { ...entry, id: "past-event" };
    const pastTask = { ...entry, id: "past-task", kind: "task" as const, status: "open" as const };
    const doneTask = { ...pastTask, id: "done-task", status: "done" as const };

    act(() => {
      root.render(<ItemChip entry={pastEvent} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="timed" past />);
    });
    expect(host.querySelector(".item-chip")?.className).toContain("is-past");
    expect(host.querySelector<HTMLElement>(".item-chip")?.style.opacity).toBe("0.62");

    act(() => {
      root.render(<ItemChip entry={pastTask} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="timed" past />);
    });
    expect(host.querySelector(".item-chip")?.className).toContain("is-past");
    expect(host.querySelector<HTMLElement>(".item-chip")?.style.opacity).toBe("1");

    act(() => {
      root.render(<ItemChip entry={doneTask} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="timed" past />);
    });
    expect(host.querySelector<HTMLElement>(".item-chip")?.style.opacity).toBe("0.62");
  });
});
