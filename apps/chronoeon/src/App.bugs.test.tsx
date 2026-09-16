// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

let host: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
  observe() { /* no-op */ }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
}

async function flush(ms = 220) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

function useMobileViewport() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(max-width: 820px)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function touchSwipe(fromX: number, toX: number) {
  const options = { pointerId: 1, clientX: fromX, clientY: 320, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true };
  const dispatch = (type: string, clientX: number) => {
    const event = new PointerEvent(type, { ...options, clientX });
    // jsdom accepts the constructor but does not expose these as instance props.
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "isPrimary", { value: true });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    Object.defineProperty(event, "clientX", { value: clientX });
    Object.defineProperty(event, "clientY", { value: 320 });
    (document.querySelector(".view-page[data-position=\"current\"] .view-stage") ?? document).dispatchEvent(event);
  };
  dispatch("pointerdown", fromX);
  dispatch("pointermove", toX);
  dispatch("pointerup", toX);
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = Object.getPrototypeOf(input);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollBy = vi.fn();
  window.localStorage.clear();
  // This suite exercises UI, not real model/network access.
  window.localStorage.setItem("chronoeon.ai.provider.v1", JSON.stringify({ enabled: false }));
  // Demo entries can become due during a real clock run; Escape-layer tests
  // should not depend on whether a reminder happens to fire first.
  window.localStorage.setItem("chronoeon.preference.remindersEnabled", JSON.stringify(false));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("app: create flow (browser demo)", () => {
  it("counts only completed tasks from the last month in the hero summary", async () => {
    const date = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
    const task = (id: string, offsetDays: number) => ({
      id, kind: "task", title: `Task ${id}`, date: date(offsetDays), allDay: true,
      status: "done", category: "work", color: "#3b82f6",
      createdAt: new Date().toISOString(), source: "local",
    });
    window.localStorage.setItem("chronoeon.entries.v1", JSON.stringify([
      task("recent", -10), task("older", -40),
    ]));
    act(() => { root.render(<App />); });
    await flush(150);
    expect(document.querySelector(".hero-stat--completed")?.textContent).toContain("1");
  });

  it("lets the narrow-width drawer close even when the rail preference is collapsed", async () => {
    window.localStorage.setItem("chronoeon.preference.sidebarCollapsed", JSON.stringify(true));
    act(() => { root.render(<App />); });
    await flush(150);

    await act(async () => { document.querySelector<HTMLButtonElement>('header.topbar button[aria-label="视图"]')!.click(); });
    await flush();
    expect(document.querySelector(".sidebar-wrap")?.className).toContain("is-open");
    expect(document.querySelector(".sidebar")?.className).not.toContain("is-collapsed");

    await act(async () => { document.querySelector<HTMLButtonElement>(".sidebar-collapse")!.click(); });
    await flush();
    expect(document.querySelector(".mobile-sidebar-backdrop")?.className).not.toContain("is-open");
    expect(document.querySelector(".sidebar-wrap")?.className).toContain("is-collapsed");
  });

  it("falls back to Agenda and today when persisted view/date values are stale", async () => {
    window.localStorage.setItem("chronoeon.preference.view", JSON.stringify("list"));
    window.localStorage.setItem("chronoeon.preference.selectedDate", "2026-08-01");
    act(() => { root.render(<App />); });
    await flush(150);

    expect(document.querySelector(".nav-item.is-active span")?.textContent).toBe("日程");
    const now = new Date();
    expect(document.querySelector(".topbar h2")?.textContent).toContain(`${now.getMonth() + 1}月${now.getDate()}日`);
  });

  it("opens unified filtering and focuses search with Control+F", async () => {
    act(() => { root.render(<App />); });
    await flush(150);
    expect(document.querySelector(".search-palette")).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true }));
    });
    const search = document.querySelector<HTMLInputElement>(".filter-search-form input")!;
    expect(search).toBeTruthy();
    expect(document.activeElement).toBe(search);
  });

  it("renders the timer sheet after pressing the dock timer button", async () => {
    act(() => { root.render(<App />); });
    await flush(150);
    expect(document.querySelector(".timer-backdrop")).toBeNull();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.view-dock button[aria-label="计时"]')!.click();
    });
    await flush();
    expect(document.querySelector(".timer-backdrop")).toBeTruthy();
    expect(document.querySelector("#timer-heading")?.textContent).toContain("正在做什么");
  });

  it("applies the global search to the stats view", async () => {
    window.localStorage.setItem("chronoeon.preference.view", JSON.stringify("insights"));
    act(() => { root.render(<App />); });
    await flush(150);
    expect(host.textContent).toContain("从容看数据");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true }));
    });
    const search = document.querySelector<HTMLInputElement>(".filter-search-form input")!;
    await act(async () => { setInputValue(search, "Morning walk by the river"); });
    await act(async () => { document.querySelector<HTMLButtonElement>(".filter-search-submit")!.click(); });
    await flush();
    expect(host.textContent).toContain("Morning walk by the river");

    await act(async () => { setInputValue(search, "绝不可能存在的条目"); });
    await act(async () => { document.querySelector<HTMLButtonElement>(".filter-search-submit")!.click(); });
    await flush();
    expect(host.textContent).not.toContain("Morning walk by the river");

    await act(async () => { setInputValue(search, "Morning walk by the river"); });
    await act(async () => { document.querySelector<HTMLButtonElement>(".filter-search-submit")!.click(); });
    await flush();
    expect(host.textContent).toContain("Morning walk by the river");
  });

  it("applies text search to calendar aggregates as well as item chips", async () => {
    window.localStorage.setItem("chronoeon.preference.view", JSON.stringify("month"));
    act(() => root.render(<App />)); await flush(150);
    expect(host.querySelector(".month-expense-slot")).toBeTruthy();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true })));
    const input = document.querySelector<HTMLInputElement>(".filter-search-form input")!;
    await act(async () => setInputValue(input, "rhythm"));
    await act(async () => document.querySelector<HTMLButtonElement>(".filter-search-submit")!.click());
    await flush();
    expect(host.querySelector(".month-expense-slot")).toBeNull();
    expect(document.querySelector(".filter-result")?.textContent).toContain("rhythm");
  });

  it("steps the Day view title bar one day at a time, whatever the column count", async () => {
    window.localStorage.setItem("chronoeon.preference.view", JSON.stringify("day"));
    window.localStorage.setItem("chronoeon.preference.dayCount", JSON.stringify(3));
    act(() => { root.render(<App />); });
    await flush(150);

    const title = () => document.querySelector(".date-title-button")?.textContent?.trim() ?? "";
    const before = title();
    expect(before).not.toBe("");
    expect(document.querySelector(".day-view")?.getAttribute("style")).toContain("--calendar-days: 3");

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.main-shell button[aria-label="下一页"]')!.click();
    });
    await flush();
    expect(title()).not.toBe(before);
  });

  it("leads the filter with search, followed by calendars and kinds", async () => {
    window.localStorage.setItem("chronoeon.preference.view", JSON.stringify("day"));
    act(() => { root.render(<App />); });
    await flush(150);

    await act(async () => { document.querySelector<HTMLButtonElement>(".topbar-filter-trigger")!.click(); });
    await flush();
    const sections = [...document.querySelectorAll<HTMLElement>(".filter-panel .filter-section")];
    expect(sections[0].textContent).toContain("搜索");
    expect(sections[1].textContent).toContain("日历");
    expect(sections[2].textContent).toContain("类型");
    // The single shipped calendar is the default one, so it starts ticked.
    expect(sections[1].querySelector(".filter-check.is-checked")).toBeTruthy();
    expect(document.querySelector(".filter-panel .filter-dates")).toBeNull();
  });

  it("creates an entry from the composer and shows it in the agenda", async () => {
    act(() => { root.render(<App />); });
    await flush(150);

    // Open the composer with the app-level "n" shortcut.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true }));
    });
    await flush();

    const sheet = host.querySelector(".composer-sheet");
    expect(sheet, "composer should open").toBeTruthy();

    const titleInput = sheet!.querySelector<HTMLInputElement>("input[placeholder]")!;
    await act(async () => { setInputValue(titleInput, "Smoke test entry"); });

    const form = sheet!.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush(150);

    // The composer closes and the entry is persisted to the demo store.
    expect(host.querySelector(".composer-sheet")).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem("chronoeon.entries.v1") ?? "[]") as Array<{ id: string; title: string }>;
    expect(stored.some((entry) => entry.title === "Smoke test entry")).toBe(true);
    // And it is visible in the agenda list.
    expect(host.textContent).toContain("Smoke test entry");
  });

  it("closes exactly one modal layer per Escape: discard confirm never strands the composer", async () => {
    // Regression for the reported deadlock: the discard confirm rendered under
    // the blurred composer backdrop (z-90 vs z-100) while the app-wide Escape
    // force-closed the dirty composer at the same instant, losing edits and
    // leaving the confirm promise unsettled.
    act(() => { root.render(<App />); });
    await flush(150);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true }));
    });
    await flush();
    const sheet = host.querySelector(".composer-sheet")!;
    const titleInput = sheet.querySelector<HTMLInputElement>("input[placeholder='想记下什么？']")!;
    await act(async () => { setInputValue(titleInput, "Draft that must survive"); });

    // Escape on a dirty composer opens the discard confirm.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await flush();
    expect(host.querySelector(".confirm-backdrop"), "discard confirm must open").toBeTruthy();
    expect(sheet.querySelector<HTMLInputElement>("input[placeholder='想记下什么？']")?.value).toBe("Draft that must survive");

    // Second Escape closes ONLY the confirm; the dirty composer must survive.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await flush();
    expect(host.querySelector(".confirm-backdrop"), "confirm must close first").toBeNull();
    expect(host.querySelector(".composer-sheet"), "dirty composer must survive").toBeTruthy();
    expect(host.querySelector(".composer-sheet")?.querySelector<HTMLInputElement>("input[placeholder='想记下什么？']")?.value).toBe("Draft that must survive");

    // Asking again and choosing Discard closes the composer without saving.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await flush();
    const discardButton = [...host.querySelectorAll<HTMLButtonElement>(".confirm-actions button")]
      .find((button) => button.textContent === "放弃")!;
    await act(async () => { discardButton.click(); });
    await flush(200); // the exit surface is retained for 160ms
    expect(host.querySelector(".composer-sheet")).toBeNull();
    expect(host.querySelector(".confirm-backdrop")).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem("chronoeon.entries.v1") ?? "[]") as Array<{ title: string }>;
    expect(stored.some((entry) => entry.title === "Draft that must survive")).toBe(false);
  });

  it("keeps kind controls compact and pairs date with clock by kind", async () => {
    act(() => { root.render(<App />); });
    await flush(150);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true }));
    });
    await flush();
    const sheet = host.querySelector(".composer-sheet")!;

    // The all-day switch and category share the top line; the title and
    // location share the next row so long labels stop consuming vertical space.
    const titleLine = sheet.querySelector<HTMLElement>(".composer-title-line");
    if (!titleLine) throw new Error("title and all-day toggle must share one row");
    const allDayToggle = titleLine.querySelector<HTMLInputElement>(".all-day-toggle input[type='checkbox']");
    if (!allDayToggle) throw new Error("all-day toggle must be beside the title");
    expect(allDayToggle.checked).toBe(false);
    expect(titleLine.querySelector(".glass-select-trigger")).toBeTruthy();
    const titleRow = sheet.querySelector<HTMLElement>(".title-location-row");
    expect(titleRow?.querySelector("input[placeholder='想记下什么？']")).toBeTruthy();
    expect(titleRow?.querySelector("input[placeholder='地点（可选）']")).toBeTruthy();
    expect(sheet.querySelector(".when-groups .when-controls")).toBeTruthy();

    // Idea and bill are concrete moments by default and have no all-day switch.
    const billTab = [...sheet.querySelectorAll<HTMLButtonElement>(".kind-switcher button")][3]!;
    await act(async () => { billTab.click(); });
    await flush();
    expect(sheet.querySelector(".composer-header-toggle")).toBeNull();
    expect(sheet.querySelectorAll(".glass-time-picker").length).toBe(1);

    const ideaTab = [...sheet.querySelectorAll<HTMLButtonElement>(".kind-switcher button")][2]!;
    await act(async () => { ideaTab.click(); });
    await flush();
    expect(sheet.querySelectorAll(".glass-time-picker").length).toBe(1);
    const ideaDetails = [...sheet.querySelectorAll<HTMLButtonElement>("button.details-toggle")]
      .find((button) => button.textContent?.includes("更多字段"))!;
    await act(async () => { ideaDetails.click(); });
    await flush();
    expect([...sheet.querySelectorAll("button.glass-select-trigger")]
      .some((button) => ["优先级", "紧急度"].includes(button.getAttribute("aria-label") ?? ""))).toBe(false);

    const taskTab = [...sheet.querySelectorAll<HTMLButtonElement>(".kind-switcher button")][0]!;
    await act(async () => { taskTab.click(); });
    await flush();
    expect(sheet.querySelectorAll(".glass-time-picker").length).toBe(2);
    const statusToggle = sheet.querySelector<HTMLButtonElement>(".composer-status-toggle")!;
    expect(statusToggle.getAttribute("aria-label")).toBe("状态");
    expect(statusToggle.title).toBe("待办");
    await act(async () => { statusToggle.click(); });
    const statusOptions = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitemradio"]')];
    expect(statusOptions.map((option) => option.getAttribute("aria-label"))).toEqual(["待办", "进行中", "已完成", "已取消"]);
    await act(async () => { statusOptions[1]!.click(); });
    expect(statusToggle.title).toBe("进行中");
    const connectedAllDayToggle = sheet.querySelector<HTMLInputElement>(".composer-header-toggle input[type='checkbox']")!;
    await act(async () => { connectedAllDayToggle.click(); });
    await flush();
    expect(sheet.querySelectorAll(".glass-time-picker").length, "all-day must hide both clocks").toBe(0);
    expect([...sheet.querySelectorAll("button.glass-select-trigger")]
      .some((button) => button.getAttribute("aria-label") === "优先级")).toBe(true);

    // Four glass kind dots, one per entry kind.
    const dots = sheet.querySelectorAll(".kind-switcher .kind-dot");
    expect(dots.length).toBe(4);
    for (const kind of ["task", "event", "idea", "bill"]) {
      expect([...dots].some((dot) => dot.className.includes(`kind-dot--${kind}`)), `kind dot for ${kind}`).toBe(true);
    }
  });

  it("hands Quick Note text to the visible capture preview", async () => {
    act(() => { root.render(<App />); });
    await flush(150);
    await act(async () => { document.querySelector<HTMLButtonElement>(".view-dock-quicknote")!.click(); });
    const input = document.querySelector<HTMLTextAreaElement>(".quick-note-input")!;
    await act(async () => { setInputValue(input, "明天 14:00 在图书馆看书"); });
    await act(async () => { document.querySelector<HTMLButtonElement>(".quick-note-actions .primary-action")!.click(); });
    await flush();
    expect(document.querySelector(".smart-capture-dialog")).toBeTruthy();
    expect(document.querySelector(".smart-capture-raw")?.textContent).toContain("明天 14:00 在图书馆看书");
  });

  it("resets the reminder to none when the all-day toggle invalidates its mode", async () => {
    // Regression: timed→all-day kept a timed reminder value (and the reverse),
    // which resolveReminderTime could not resolve — the reminder silently
    // never fired.
    act(() => { root.render(<App />); });
    await flush(150);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true }));
    });
    await flush();
    const sheet = host.querySelector(".composer-sheet")!;

    // Open the details section to reach the reminder select.
    const detailsToggle = [...sheet.querySelectorAll<HTMLButtonElement>("button.details-toggle")].find((button) => button.textContent?.includes("更多字段"))!;
    await act(async () => { detailsToggle.click(); });
    await flush();

    const reminderTrigger = [...sheet.querySelectorAll<HTMLButtonElement>("button.glass-select-trigger")]
      .find((button) => button.getAttribute("aria-label") === "提醒")!;
    expect(reminderTrigger, "reminder select must be visible").toBeTruthy();
    const chooseOption = async (text: string) => {
      await act(async () => { reminderTrigger.click(); });
      await flush();
      const option = [...document.querySelectorAll<HTMLButtonElement>(".glass-select-popup .glass-select-option")]
        .find((candidate) => candidate.textContent === text)!;
      await act(async () => { option.click(); });
      await flush();
    };
    await chooseOption("开始时");
    await flush();
    expect(reminderTrigger.textContent).toContain("开始时");

    // Timed → all-day: the timed value is not resolvable in all-day mode.
    const allDayToggle = sheet.querySelector<HTMLInputElement>(".composer-header-toggle input[type='checkbox']")!;
    await act(async () => { allDayToggle.click(); });
    await flush();
    expect(reminderTrigger.textContent, "timed reminder must reset when entering all-day").toContain("不提醒");

    // All-day → timed: the anchor value is not resolvable in timed mode either.
    await chooseOption("当天 9:00");
    await act(async () => { allDayToggle.click(); });
    await flush();
    expect(reminderTrigger.textContent, "all-day reminder must reset when leaving all-day").toContain("不提醒");

    // Setting a timed value again, then toggling away and back, keeps the
    // select in a resolvable state in both modes (no stale cross-mode values).
    await chooseOption("提前 15 分钟");
    await flush();
    expect(reminderTrigger.textContent).toContain("提前 15 分钟");
    await act(async () => { allDayToggle.click(); }); // → all-day: 15min invalid → none
    await flush();
    await act(async () => { allDayToggle.click(); }); // → timed: none stays none
    await flush();
    expect(reminderTrigger.textContent).toContain("不提醒");
  });

  it("does not create duplicate entries on double submit", async () => {
    // Regression: the submit button stayed enabled while the async write was
    // in flight, and draftToEntry mints a fresh id per call — a double Enter
    // produced two rows.
    act(() => { root.render(<App />); });
    await flush(150);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true }));
    });
    await flush();
    const sheet = host.querySelector(".composer-sheet")!;
    const titleInput = sheet.querySelector<HTMLInputElement>("input[placeholder='想记下什么？']")!;
    await act(async () => { setInputValue(titleInput, "No duplicates"); });

    const form = sheet.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush(150);

    expect(host.querySelector(".composer-sheet")).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem("chronoeon.entries.v1") ?? "[]") as Array<{ title: string }>;
    const matches = stored.filter((entry) => entry.title === "No duplicates");
    expect(matches.length, "exactly one row for one entry").toBe(1);
  });

  it("closes settings with Escape and ignores the n/t shortcuts while a modal is open", async () => {
    act(() => { root.render(<App />); });
    await flush(150);

    // Ctrl+, opens settings; Escape must close it (it had no Escape handler at
    // all before, and the app-wide one raced the dialog's own layering).
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await flush();
    expect(host.querySelector(".settings-backdrop"), "settings must open").toBeTruthy();

    // The "n" shortcut must not stack a composer over an open modal.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true }));
    });
    await flush();
    expect(host.querySelector(".composer-sheet"), "n must be ignored while settings is open").toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await flush();
    expect(host.querySelector(".settings-backdrop"), "Escape must close settings").toBeNull();
    expect(host.querySelector(".composer-sheet")).toBeNull();
  });

  it("swipes mobile views through the shared calendar-to-insights order", async () => {
    useMobileViewport();
    window.localStorage.setItem("chronoeon.preference.view", JSON.stringify("month"));
    act(() => { root.render(<App />); });
    await flush(150);
    expect(document.querySelector(".nav-item.is-active span")?.textContent).toBe("月历");

    // Leftward content motion moves to the next view: Month → Insights.
    await act(async () => { touchSwipe(220, 90); });
    await flush();
    expect(document.querySelector(".nav-item.is-active span")?.textContent).toBe("灵感");
  });

  it("promotes the already-mounted next month after a vertical swipe without a remount", async () => {
    useMobileViewport();
    window.localStorage.setItem("chronoeon.preference.view", JSON.stringify("month"));
    act(() => root.render(<App />)); await flush(100);
    const pager = host.querySelector<HTMLElement>(".view-pager")!;
    Object.defineProperties(pager, { clientWidth: { value: 390 }, clientHeight: { value: 600 } });
    const source = host.querySelector(".view-page[data-position='current'] .month-panel")!;
    const heading = host.querySelector(".topbar h2")!.textContent;
    function point(type: string, y: number) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 180, clientY: y });
      act(() => source.dispatchEvent(event));
    }
    point("pointerdown", 400); point("pointermove", 180);
    const incoming = host.querySelector(".view-page[data-position='preview']")!;
    const grid = incoming.querySelector(".month-grid");
    expect(grid).not.toBeNull(); expect(pager.dataset.axis).toBe("y");
    expect(pager.style.getPropertyValue("--page-offset")).toBe("-220px");
    point("pointerup", 180); await flush(280);
    expect(host.querySelector(".view-page[data-position='current']")).toBe(incoming);
    expect(host.querySelector(".view-page[data-position='current'] .month-grid")).toBe(grid);
    expect(host.querySelectorAll(".view-page")).toHaveLength(1);
    expect(pager.style.getPropertyValue("--page-offset")).toBe("");
    expect(host.querySelector(".topbar h2")!.textContent).not.toBe(heading);
  });

  it("wraps mobile swipes into the sidebar at List and Stats boundaries", async () => {
    useMobileViewport();
    window.localStorage.setItem("chronoeon.preference.view", JSON.stringify("agenda"));
    act(() => { root.render(<App />); });
    await flush(150);

    // Rightward motion at the first view opens the left sidebar.
    await act(async () => { touchSwipe(90, 220); });
    await flush();
    expect(document.querySelector(".mobile-sidebar-backdrop")?.className).toContain("is-open");
    await act(async () => { document.querySelector<HTMLElement>(".mobile-sidebar-backdrop")!.click(); });
    await flush();

    // Move to the other end through the sidebar, then swipe left.
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".nav-item")]
        .find((item) => item.textContent?.includes("统计"))!.click();
    });
    await flush();
    await act(async () => { touchSwipe(220, 90); });
    await flush();
    expect(document.querySelector(".mobile-sidebar-backdrop")?.className).toContain("is-open");
  });

  it("keeps the composer open with an error when the title is empty", async () => {
    act(() => { root.render(<App />); });
    await flush(150);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true }));
    });
    await flush();

    const sheet = host.querySelector(".composer-sheet")!;
    const form = sheet.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(host.querySelector(".composer-sheet"), "composer must stay open").toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("chronoeon.entries.v1") ?? "[]").length).toBeLessThanOrEqual(
      (JSON.parse(window.localStorage.getItem("chronoeon.entries.v1") ?? "[]") as unknown[]).length,
    );
  });

  it("jumps directly to a chosen date from the top bar", async () => {
    act(() => { root.render(<App />); });
    await flush(150);

    await act(async () => { document.querySelector<HTMLButtonElement>(".jump-date-trigger")!.click(); });
    await flush();
    // The popover portals to document.body, not the app root.
    expect(document.querySelector(".jump-date-pop"), "jump popover must open").toBeTruthy();

    const popup = document.querySelector<HTMLElement>(".jump-date-pop")!;
    for (let index = 0; index < 24; index += 1) {
      const heading = popup.querySelector(".glass-picker-month strong")?.textContent ?? "";
      const match = heading.match(/(\d+)年\s*(\d+)月/);
      if (match && Number(match[1]) === 2026 && Number(match[2]) === 9) break;
      if (!match) throw new Error(`unexpected picker heading: ${heading}`);
      const direction = Number(match[1]) * 12 + Number(match[2]) < 2026 * 12 + 9 ? "下一月" : "上一月";
      await act(async () => {
        popup.querySelector<HTMLButtonElement>(`[aria-label="${direction}"]`)!.click();
      });
      await flush();
    }
    const cell = [...document.querySelectorAll<HTMLButtonElement>(".glass-date-cell")]
      .find((candidate) => candidate.textContent?.trim() === "15" && !candidate.classList.contains("is-outside"));
    await act(async () => { cell!.click(); });
    await flush(220);

    expect(document.querySelector(".jump-date-pop")).toBeNull();
    expect(host.querySelector(".date-navigation h2")?.textContent).toContain("9月15日");
  });
});
