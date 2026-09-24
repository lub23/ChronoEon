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
  it("renders mini window and settings with one shared utility class", () => {
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
          onOpenSettings={vi.fn()}
        />,
      );
    });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button.sidebar-utility")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["迷你窗口", "设置", "检查更新"]);
    expect(host.querySelector(".sidebar-action, .sidebar-chat-button, .sidebar-settings-button")).toBeNull();
    for (const button of buttons) {
      expect(button.querySelector("svg")?.getAttribute("width")).toBe("15");
    }
  });

  it("steps the day range with − and + while Day view is active", async () => {
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
          onOpenSettings={vi.fn()}
        />,
      );
    });
    expect(host.querySelector(".sidebar-day-count")?.textContent).toBe("3");
    const [fewer, more] = [...host.querySelectorAll<HTMLButtonElement>(".sidebar-day-step")];
    expect(fewer.getAttribute("aria-label")).toBe("少显示一天");
    expect(more.getAttribute("aria-label")).toBe("多显示一天");
    await act(async () => { more.click(); });
    expect(onDayCountChange).toHaveBeenCalledWith(4);
    await act(async () => { fewer.click(); });
    expect(onDayCountChange).toHaveBeenCalledWith(2);
  });

  it("disables the stepper at one and six days", () => {
    const renderAt = (dayCount: number) => {
      act(() => {
        root.render(
          <Sidebar
            locale="zh"
            activeView="day"
            collapsed={false}
            dayCount={dayCount}
            onViewChange={vi.fn()}
            onDayCountChange={vi.fn()}
            onCollapsedChange={vi.fn()}
            onNew={vi.fn()}
            onCompact={vi.fn()}
            onOpenSettings={vi.fn()}
          />,
        );
      });
      return [...host.querySelectorAll<HTMLButtonElement>(".sidebar-day-step")].map((button) => button.disabled);
    };
    expect(renderAt(1)).toEqual([true, false]);
    expect(renderAt(6)).toEqual([false, true]);
  });

  it("badges the collapsed day icon and opens the day menu from it", async () => {
    const onDayCountChange = vi.fn();
    act(() => {
      root.render(
        <Sidebar
          locale="zh"
          activeView="day"
          collapsed
          dayCount={4}
          onViewChange={vi.fn()}
          onDayCountChange={onDayCountChange}
          onCollapsedChange={vi.fn()}
          onNew={vi.fn()}
          onCompact={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
    });
    const dayButton = [...host.querySelectorAll<HTMLButtonElement>(".nav-item")]
      .find((button) => button.getAttribute("aria-label") === "日视图")!;
    expect(dayButton.querySelector(".nav-day-badge")?.textContent).toBe("4");
    expect(host.querySelector(".nav-day-menu")).toBeNull();

    await act(async () => { dayButton.click(); });
    const options = [...host.querySelectorAll<HTMLButtonElement>(".nav-day-menu button")];
    expect(options).toHaveLength(6);
    expect(options.find((option) => option.getAttribute("aria-checked") === "true")?.textContent).toContain("4");
    await act(async () => { options[0].click(); });
    expect(onDayCountChange).toHaveBeenCalledWith(1);
    expect(host.querySelector(".nav-day-menu")).toBeNull();
  });

  it("shows the running version with an update check that needs the app shell", async () => {
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
          onOpenSettings={vi.fn()}
        />,
      );
    });
    await act(async () => { await Promise.resolve(); });
    const version = host.querySelector(".sidebar-version")!;
    expect(version.querySelector("span")?.textContent).toBe("时元");
    expect(version.querySelector("b")?.textContent).toMatch(/^v\d+\.\d+\.\d+$/);
    // The browser demo has no installer, so the check stays inert.
    const check = host.querySelector<HTMLButtonElement>('.sidebar-utility[aria-label="检查更新"]')!;
    expect(check.disabled).toBe(true);
    expect(check.title).toBe("更新仅适用于已安装的应用");
  });
});
