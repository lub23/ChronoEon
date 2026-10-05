// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings, type Entry } from "@chronoeon/domain";
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

  it("keeps the idea tab selected when editing an existing idea", () => {
    const idea: Entry = {
      id: "idea-edit",
      kind: "idea",
      title: "Recorded thought",
      date: "2026-09-09",
      allDay: true,
      category: "default",
      color: "#90d7ec",
      createdAt: "2026-09-09T10:00:00.000Z",
    };
    act(() => {
      root.render(
        <EntryComposer
          locale="zh"
          selectedDate="2026-09-09"
          editing={idea}
          settings={createDefaultSettings("zh")}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("灵感");
    expect(host.querySelector(".composer-pair--note-only")).not.toBeNull();
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

  it("updates untouched location after title changes and leaves edited records alone", async () => {
    const settings = createDefaultSettings();
    const history: CaptureHistoryItem[] = [
      { kind: "event", title: "Yoga", category: "default", location: "Gym", date: "2026-09-12" },
      { kind: "event", title: "Design review", category: "default", location: "Office", date: "2026-09-12" },
    ];
    act(() => root.render(<EntryComposer locale="en" selectedDate="2026-09-12" editing={null} settings={settings} history={history} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} />));
    const title = host.querySelector<HTMLInputElement>(".field-label--title input")!;
    const location = host.querySelector<HTMLInputElement>(".location-input-wrap input")!;
    await act(async () => setInputValue(title, "Yoga")); expect(location.value).toBe("Gym");
    await act(async () => setInputValue(title, "Design review")); expect(location.value).toBe("Office");
    await act(async () => setInputValue(title, "")); expect(location.value).toBe("");
    expect(host.querySelectorAll('[role="tab"] svg')).toHaveLength(5);
    expect(host.querySelector('.kind-dot')).toBeNull();
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

  it("replaces typed location content when a pointer candidate is chosen", async () => {
    const history: CaptureHistoryItem[] = [
      { kind: "event", title: "Design review", category: "default", location: "Office", date: "2026-09-12" },
    ];
    act(() => root.render(<EntryComposer locale="en" selectedDate="2026-09-12" editing={null} settings={createDefaultSettings("en")} history={history} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} />));
    const title = host.querySelector<HTMLInputElement>(".field-label--title input")!;
    await act(async () => setInputValue(title, "Design review"));
    const location = host.querySelector<HTMLInputElement>(".location-input-wrap input")!;
    act(() => location.focus());
    await act(async () => setInputValue(location, "Of"));
    const candidate = host.querySelector<HTMLButtonElement>(".field-suggestion-menu button")!;
    expect(candidate.textContent).toBe("Office");
    await act(async () => candidate.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true })));
    expect(location.value).toBe("Office");
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

  it.each([
    [{ kind: "task", allDay: false }, "提前 30min"],
    [{ kind: "task", allDay: true }, "前一天 17:00"],
  ] as const)("defaults new task reminders by time mode", async (seed, label) => {
    act(() => {
      root.render(
        <EntryComposer
          locale="zh"
          selectedDate="2026-09-09"
          editing={null}
          settings={createDefaultSettings()}
          initialDraft={seed}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="提醒"]')?.textContent).toContain(label);
  });

  it("creates one linked asset from the bill composer when a category is chosen", async () => {
    const saved = {
      id: "bill-saved", title: "相机", kind: "bill", category: "expense",
      date: "2026-09-09", amount: 300, currency: "CNY", createdAt: "2026-09-09T00:00:00Z",
    } as Entry;
    const onSave = vi.fn(async () => saved);
    const onCreateItemFromBill = vi.fn(async () => {});
    act(() => {
      root.render(
        <EntryComposer
          locale="zh"
          selectedDate="2026-09-09"
          editing={null}
          settings={createDefaultSettings("zh")}
          initialDraft={{ kind: "bill", title: "相机" }}
          onClose={vi.fn()}
          onSave={onSave}
          onDelete={vi.fn()}
          onCreateItemFromBill={onCreateItemFromBill}
        />,
      );
    });
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="添加物品"]')!.click(); });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".glass-select-option")]
        .find((option) => option.textContent?.includes("电子产品"))!.click();
    });
    await act(async () => { host.querySelector<HTMLButtonElement>(".composer-footer .primary-action")!.click(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCreateItemFromBill).toHaveBeenCalledWith(saved, "electronics");
  });
});

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
