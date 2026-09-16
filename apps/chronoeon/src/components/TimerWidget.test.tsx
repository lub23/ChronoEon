// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings, createTimerSession } from "@chronoeon/domain";
import type { LiveTimer } from "../hooks/useLiveTimer";
import { TimerWidget } from "./TimerWidget";

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

function fakeTimer(overrides: Partial<LiveTimer> = {}): LiveTimer {
  return {
    session: null,
    ready: true,
    finishing: false,
    running: false,
    active: false,
    elapsed: 0,
    recovered: false,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => undefined),
    cancel: vi.fn(),
    update: vi.fn(),
    dismissRecovered: vi.fn(),
    ...overrides,
  };
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TimerWidget", () => {
  it("offers category in the header plus title, location, note and photos before starting", () => {
    const settings = createDefaultSettings();
    const timer = fakeTimer();
    act(() => {
      root.render(<TimerWidget locale="zh" settings={settings} timer={timer} open onClose={vi.fn()} />);
    });
    const header = host.querySelector(".timer-header")!;
    const children = [...header.children].map((node) => node.className);
    expect(children[0]).toContain("timer-header-main");
    expect(children[1]).toContain("timer-category");
    expect(children[2]).toContain("icon-button");
    expect(header.querySelector('[aria-label="分类"]')).not.toBeNull();

    const title = host.querySelector<HTMLInputElement>('input[placeholder="例如：专注、阅读、健身"]')!;
    const location = host.querySelector<HTMLInputElement>('input[placeholder="地点（可选）"]')!;
    const note = host.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(title && location && note).toBeTruthy();
    expect(host.querySelector(".attachment-field")).not.toBeNull();
    expect(title.closest(".timer-start-fields")).not.toBeNull();
    expect(host.querySelector(".timer-begin")?.closest(".timer-start-fields")).toBeNull();

    act(() => { type(title, "阅读"); type(location, "图书馆"); type(note, "第三章"); });
    act(() => { host.querySelector("form.timer-start-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(timer.start).toHaveBeenCalledWith({
      title: "阅读",
      calendarId: settings.defaultCalendarID,
      kind: "event",
      category: settings.calendars[0].defaultCategoryId,
      location: "图书馆",
      note: "第三章",
      images: undefined,
    });
  });

  it("infers the event category from history and stops after a manual choice", async () => {
    const settings = createDefaultSettings();
    settings.calendars[0].categories = [
      { id: "health", name: "健康", color: "#65c294" },
      { id: "work", name: "工作", color: "#145b7e" },
    ];
    settings.calendars[0].defaultCategoryId = "health";
    const history = [{ kind: "event" as const, title: "健身", category: "health", date: "2026-09-11" }];
    const timer = fakeTimer();
    act(() => {
      root.render(<TimerWidget locale="zh" settings={settings} timer={timer} open history={history} onClose={vi.fn()} />);
    });
    const title = host.querySelector<HTMLInputElement>('input[placeholder="例如：专注、阅读、健身"]')!;
    act(() => { type(title, "今天健身一小时"); });
    expect(host.querySelector(".timer-category .glass-select-value")?.textContent).toContain("健康");

    await act(async () => { host.querySelector<HTMLButtonElement>(".timer-category .glass-select-trigger")!.click(); });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".glass-select-option")]
        .find((option) => option.textContent?.includes("工作"))!.click();
    });
    act(() => { type(title, "今天健身一小时；临时会议"); });
    expect(host.querySelector(".timer-category .glass-select-value")?.textContent).toContain("工作");
  });

  it("shows category and location while running and lets details be edited", () => {
    const settings = createDefaultSettings();
    const session = createTimerSession({ title: "阅读", calendarId: settings.defaultCalendarID, category: settings.calendars[0].defaultCategoryId, location: "图书馆" }, Date.now());
    const timer = fakeTimer({ session, active: true, running: true, elapsed: 65_000 });
    act(() => {
      root.render(<TimerWidget locale="zh" settings={settings} timer={timer} open onClose={vi.fn()} />);
    });
    expect(host.querySelector(".timer-header .timer-category")).toBeNull();
    expect(host.querySelector(".timer-meta")?.textContent).toContain("图书馆");
    expect(host.querySelector(".timer-readout")?.textContent).toBe("1:05");
    const note = host.querySelector<HTMLTextAreaElement>(".timer-details textarea")!;
    act(() => { type(note, "补充"); });
    expect(timer.update).toHaveBeenCalledWith({ note: "补充" });
  });
});


it("keeps the timer dialog open and reports a failed save", async () => {
  const onClose = vi.fn(), onNotice = vi.fn();
  const session = createTimerSession({ title: "阅读", calendarId: "default" }, Date.now());
  const timer = fakeTimer({ session, active: true, stop: vi.fn().mockRejectedValue(new Error("disk full")) });
  await act(async () => { root.render(<TimerWidget locale="zh" settings={createDefaultSettings()} timer={timer} open onClose={onClose} onNotice={onNotice} />); });
  await act(async () => { host.querySelector<HTMLButtonElement>(".timer-controls .primary-action")!.click(); });
  expect(onClose).not.toHaveBeenCalled();
  expect(onNotice).toHaveBeenCalledWith("计时保存失败，记录已暂停并保留，请重试。", "warning");
});

it("does not start before SQLite hydration is ready", () => {
  const timer = fakeTimer({ ready: false });
  act(() => { root.render(<TimerWidget locale="zh" settings={createDefaultSettings()} timer={timer} open onClose={vi.fn()} />); });
  expect(host.querySelector<HTMLButtonElement>(".timer-begin")!.disabled).toBe(true);
  act(() => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(timer.start).not.toHaveBeenCalled();
});
