// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@chronoeon/domain";
import type { CaptureHistoryItem } from "@chronoeon/domain";
import { EntryComposer } from "./EntryComposer";

let host: HTMLDivElement;
let root: Root;

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

describe("EntryComposer defaults", () => {
  it("opens a brand-new entry as an event", () => {
    act(() => {
      root.render(
        <EntryComposer
          locale="zh"
          selectedDate="2026-09-09"
          editing={null}
          settings={createDefaultSettings()}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });
    const active = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    expect(active?.textContent).toBe("事件");
    expect(active?.className).toContain("kind-event");
  });

  it("still honours an explicit seed kind", () => {
    act(() => {
      root.render(
        <EntryComposer
          locale="zh"
          selectedDate="2026-09-09"
          editing={null}
          settings={createDefaultSettings()}
          initialDraft={{ kind: "idea", start: "10:00" }}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("灵感");
  });

  it("infers from matching history until the category is chosen manually", async () => {
    const settings = createDefaultSettings();
    settings.calendars[0].categories = [
      { id: "health", name: "健康", color: "#65c294" },
      { id: "work", name: "工作", color: "#145b7e" },
    ];
    settings.calendars[0].defaultCategoryId = "health";
    const history: CaptureHistoryItem[] = [
      { kind: "event", title: "健身", category: "health", date: "2026-09-11" },
    ];
    act(() => {
      root.render(
        <EntryComposer
          locale="zh"
          selectedDate="2026-09-12"
          editing={null}
          settings={settings}
          history={history}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });
    const title = host.querySelector<HTMLInputElement>("input[placeholder='想记下什么？']")!;
    await act(async () => { setInputValue(title, "今天健身一小时"); });
    expect(host.querySelector(".glass-select-value")?.textContent).toContain("健康");

    await act(async () => { host.querySelector<HTMLButtonElement>(".composer-category-field .glass-select-trigger")!.click(); });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".glass-select-option")]
        .find((option) => option.textContent?.includes("工作"))!.click();
    });
    await act(async () => { setInputValue(title, "今天健身一小时；临时会议"); });
    expect(host.querySelector(".glass-select-value")?.textContent).toContain("工作");
  });

  it("fills an untouched location, then respects clearing or manual entry", async () => {
    const settings = createDefaultSettings();
    const history: CaptureHistoryItem[] = [
      { kind: "event", title: "健身", category: "health", location: "滨江跑道", date: "2026-09-11" },
    ];
    act(() => {
      root.render(
        <EntryComposer
          locale="zh"
          selectedDate="2026-09-12"
          editing={null}
          settings={settings}
          history={history}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });
    const title = host.querySelector<HTMLInputElement>("input[placeholder='想记下什么？']")!;
    const location = host.querySelector<HTMLInputElement>("input[placeholder='地点（可选）']")!;
    expect(host.querySelector(".location-clear")).toBeNull();
    await act(async () => { setInputValue(title, "今天健身一小时"); });
    expect(location.value).toBe("滨江跑道");
    expect(host.querySelector(".location-clear")?.parentElement).toBe(location.parentElement);

    await act(async () => { host.querySelector<HTMLButtonElement>(".location-clear")!.click(); });
    expect(location.value).toBe("");
    await act(async () => { setInputValue(title, "今天健身一小时；晚上拉伸"); });
    expect(location.value).toBe("");
  });

  it("sets both times with the wheel instead of a free-text clock field", async () => {
    act(() => {
      root.render(
        <EntryComposer
          locale="zh"
          selectedDate="2026-09-12"
          editing={null}
          settings={createDefaultSettings()}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });
    expect(host.querySelector(".glass-time-input")).toBeNull();
    const triggers = [...host.querySelectorAll<HTMLButtonElement>(".glass-time-trigger")];
    expect(triggers.map((trigger) => trigger.textContent)).toEqual(["09:00", "09:30"]);

    await act(async () => { triggers[1].click(); });
    const hours = document.querySelector<SVGGElement>('[role="slider"][aria-label="小时"]')!;
    await act(async () => { hours.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })); });
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>(".time-dial-actions button")].find((button) => button.textContent === "完成")!.click(); });
    expect([...host.querySelectorAll<HTMLButtonElement>(".glass-time-trigger")].map((trigger) => trigger.textContent)).toEqual(["09:00", "23:30"]);
  });
});

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
