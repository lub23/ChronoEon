// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlassDatePicker } from "./GlassDateTimePicker";

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
  document.body.textContent = "";
});

describe("GlassDatePicker", () => {
  it("lets a scheduled entry move to dates after its current day", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <GlassDatePicker
          value="2026-08-30"
          onChange={onChange}
          ariaLabel="移动到日期"
          locale="zh"
          clearable={false}
        />,
      );
    });

    act(() => host.querySelector<HTMLButtonElement>(".glass-picker-trigger")!.click());
    const cells = [...document.querySelectorAll<HTMLButtonElement>(".glass-date-cell")];
    const future = cells.find((cell) => cell.className.includes("is-outside") && cell.textContent === "5" && !cell.disabled);
    expect(future).toBeTruthy();

    act(() => future!.click());
    expect(onChange).toHaveBeenCalledWith("2026-09-05");
  });

  it("shows a visual empty hint without replacing the accessible name", () => {
    act(() => {
      root.render(
        <GlassDatePicker
          onChange={vi.fn()}
          ariaLabel="结束日期"
          placeholder="不限"
          locale="zh"
        />,
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>(".glass-picker-trigger")!;
    expect(trigger.getAttribute("aria-label")).toBe("结束日期");
    expect(trigger.textContent).toBe("不限");
  });

  it("jumps calendar navigation by year and marks the displayed civil range", () => {
    act(() => {
      root.render(
        <GlassDatePicker
          value="2026-08-30"
          onChange={vi.fn()}
          ariaLabel="跳转日期"
          locale="zh"
          clearable={false}
          highlight={{ start: "2026-08-30", end: "2026-09-01" }}
        />,
      );
    });

    act(() => host.querySelector<HTMLButtonElement>(".glass-picker-trigger")!.click());
    expect(document.querySelector('.glass-picker-month strong')!.textContent).toBe("2026年8月");
    expect(document.querySelectorAll(".glass-date-cell.is-highlight")).toHaveLength(3);

    const previousYear = document.querySelector<HTMLButtonElement>('[aria-label="上一年"]')!;
    act(() => previousYear.click());
    expect(document.querySelector('.glass-picker-month strong')!.textContent).toBe("2025年8月");

    const nextYear = document.querySelector<HTMLButtonElement>('[aria-label="下一年"]')!;
    act(() => nextYear.click());
    act(() => nextYear.click());
    expect(document.querySelector('.glass-picker-month strong')!.textContent).toBe("2027年8月");
    expect(document.querySelectorAll('.glass-date-cell.is-highlight')).toHaveLength(0);
  });

  it("renders an inline calendar without an intermediate value trigger", () => {
    act(() => {
      root.render(
        <GlassDatePicker
          inline
          value="2026-08-30"
          onChange={vi.fn()}
          ariaLabel="跳转日期"
          locale="zh"
          clearable={false}
        />,
      );
    });

    expect(host.querySelector(".glass-picker-trigger")).toBeNull();
    expect(host.querySelector(".glass-date-grid")).toBeTruthy();
  });
});
