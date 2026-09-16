// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

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

describe("Sidebar", () => {
  it("renders mini window, AI advisor and settings with one shared utility class", () => {
    act(() => {
      root.render(
        <Sidebar
          locale="zh"
          activeView="agenda"
          collapsed={false}
          onViewChange={vi.fn()}
          onCollapsedChange={vi.fn()}
          onNew={vi.fn()}
          onCompact={vi.fn()}
          onChat={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
    });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button.sidebar-utility")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["迷你窗口", "AI 助手", "设置"]);
    expect(host.querySelector(".sidebar-action, .sidebar-chat-button, .sidebar-settings-button")).toBeNull();
    for (const button of buttons) {
      expect(button.querySelector("svg")?.getAttribute("width")).toBe("15");
    }
  });

  it("shows a compact day-range selector only while Day view is active", async () => {
    const onDayCountChange = vi.fn();
    act(() => {
      root.render(
        <Sidebar
          locale="zh"
          activeView="day"
          collapsed={false}
          dayCount={3}
          onViewChange={vi.fn()}
          onDayCountChange={onDayCountChange}
          onCollapsedChange={vi.fn()}
          onNew={vi.fn()}
          onCompact={vi.fn()}
          onChat={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
    });
    const select = host.querySelector<HTMLSelectElement>(".sidebar-day-count select")!;
    expect(select).toBeTruthy();
    expect(select.value).toBe("3");
    expect([...select.options].map((option) => option.value)).toEqual(["1", "2", "3", "4", "5", "6"]);
    await act(async () => { setInputValue(select, "5"); });
    expect(onDayCountChange).toHaveBeenCalledWith(5);
  });
});

function setInputValue(input: HTMLSelectElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
