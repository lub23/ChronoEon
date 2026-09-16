// @vitest-environment jsdom
import { act, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { DEFAULT_AI_PROVIDER_PREFERENCES } from "../ai/provider";
import { SmartCaptureDialog } from "./SmartCaptureDialog";

const { requestSmartCaptureMock } = vi.hoisted(() => ({ requestSmartCaptureMock: vi.fn() }));
vi.mock("../ai/provider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../ai/provider")>(),
  requestSmartCapture: requestSmartCaptureMock,
}));
const offlinePreferences = { ...DEFAULT_AI_PROVIDER_PREFERENCES, enabled: false };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  requestSmartCaptureMock.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  host.remove();
  document.querySelector(".glass-select-popup")?.remove();
});

describe("SmartCaptureDialog editor", () => {
  it("renders a collapsed preview and expands composer-aligned fields", async () => {
    act(() => {
      root.render(
        <SmartCaptureDialog
          raw="明天 14:00 评审会"
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          aiPreferences={offlinePreferences}
          onClose={() => undefined}
          onConfigureAI={() => undefined}
          onConfirm={async () => true}
        />,
      );
    });

    const card = host.querySelector<HTMLElement>(".smart-capture-card")!;
    expect(card.className).toContain("is-collapsed");
    expect(card.textContent).toContain("评审会");
    expect(host.querySelector(".smart-capture-editor")).toBeNull();

    await act(async () => { card.querySelector<HTMLButtonElement>(".smart-capture-summary")!.click(); });
    expect(host.querySelector(".smart-capture-row--three")).not.toBeNull();
    expect(host.querySelector(".smart-capture-row--split")).not.toBeNull();
    expect(host.textContent).toContain("优先级");
    expect(host.textContent).toContain("提醒");
  });

  it("shows compact amount, currency and payment fields for bills", async () => {
    act(() => {
      root.render(
        <SmartCaptureDialog
          raw="明天 14:00 评审会"
          locale="zh"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          aiPreferences={offlinePreferences}
          onClose={() => undefined}
          onConfigureAI={() => undefined}
          onConfirm={async () => true}
        />,
      );
    });
    await act(async () => { host.querySelector<HTMLButtonElement>(".smart-capture-summary")!.click(); });

    const typeTrigger = [...document.querySelectorAll<HTMLButtonElement>(".smart-capture-editor .glass-select-trigger")]
      .find((trigger) => trigger.getAttribute("aria-label") === "类型")!;
    await act(async () => { typeTrigger.click(); });
    const billOption = [...document.querySelectorAll<HTMLButtonElement>(".glass-select-popup .glass-select-option")]
      .find((option) => option.textContent === "账目")!;
    await act(async () => { billOption.click(); });

    expect(host.querySelector(".smart-capture-row--bill")).not.toBeNull();
    expect(host.textContent).toContain("金额");
    expect(host.textContent).toContain("币种");
    expect(host.textContent).toContain("支付方式");
  });
});


function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function props(overrides: Partial<ComponentProps<typeof SmartCaptureDialog>> = {}): ComponentProps<typeof SmartCaptureDialog> {
  return { raw: "明天下午3点在图书馆看书", locale: "zh", settings: DEFAULT_CHRONOEON_SETTINGS, aiPreferences: DEFAULT_AI_PROVIDER_PREFERENCES, onClose: vi.fn(), onConfigureAI: vi.fn(), onConfirm: vi.fn(async () => true), ...overrides };
}
const completion = (title: string) => ({ content: JSON.stringify({ entries: [{ kind: "event", title, date: "2026-09-10", start: "15:00", end: "16:00", category: "学习" }] }) });

describe("automatic capture enhancement", () => {
  it("shows the offline preview immediately, then applies one automatic AI response", async () => {
    const request = deferred<{ content: string }>();
    requestSmartCaptureMock.mockReturnValue(request.promise);
    await act(async () => { root.render(<SmartCaptureDialog {...props()} />); });
    expect(host.querySelector(".smart-capture-summary b")?.textContent).toBe("看书");
    expect(host.textContent).toContain("AI 解析中");
    expect(requestSmartCaptureMock).toHaveBeenCalledTimes(1);
    await act(async () => { request.resolve(completion("AI 看书")); });
    expect(host.querySelector(".smart-capture-summary b")?.textContent).toBe("AI 看书");
    expect(host.querySelector(".eyebrow")?.textContent).toBe("AI 预览");
  });

  it("does not double-request under StrictMode", async () => {
    requestSmartCaptureMock.mockResolvedValue(completion("AI 看书"));
    await act(async () => { root.render(<StrictMode><SmartCaptureDialog {...props()} /></StrictMode>); });
    expect(requestSmartCaptureMock).toHaveBeenCalledTimes(1);
  });

  it("preserves offline results after failure and exposes an explicit retry", async () => {
    requestSmartCaptureMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(completion("重试成功"));
    await act(async () => { root.render(<SmartCaptureDialog {...props()} />); });
    expect(host.querySelector(".smart-capture-summary b")?.textContent).toBe("看书");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("offline");
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "重试 AI")!;
    await act(async () => { retry.click(); });
    expect(host.querySelector(".smart-capture-summary b")?.textContent).toBe("重试成功");
    expect(requestSmartCaptureMock).toHaveBeenCalledTimes(2);
  });

  it("aborts enhancement when the user edits and ignores a late native reply", async () => {
    const request = deferred<{ content: string }>(); requestSmartCaptureMock.mockReturnValue(request.promise);
    await act(async () => { root.render(<SmartCaptureDialog {...props()} />); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".smart-capture-summary")!.click(); });
    const input = host.querySelector<HTMLInputElement>(".smart-capture-title-field input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "手动修改");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(requestSmartCaptureMock.mock.calls[0][2].aborted).toBe(true);
    await act(async () => { request.resolve(completion("迟到结果")); });
    expect(input.value).toBe("手动修改");
    expect(host.querySelector(".smart-capture-summary b")?.textContent).toBe("手动修改");
  });

  it("allows immediate offline saving and prevents double submission while AI is pending", async () => {
    const ai = deferred<{ content: string }>(), save = deferred<boolean>();
    requestSmartCaptureMock.mockReturnValue(ai.promise);
    const onConfirm = vi.fn((_drafts: Parameters<ComponentProps<typeof SmartCaptureDialog>["onConfirm"]>[0]) => save.promise);
    await act(async () => { root.render(<SmartCaptureDialog {...props({ onConfirm })} />); });
    const button = host.querySelector<HTMLButtonElement>("footer .primary-action")!;
    expect(button.disabled).toBe(false);
    await act(async () => { button.click(); button.click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0][0]).toMatchObject({ kind: "event", title: "看书", location: "图书馆" });
    expect(requestSmartCaptureMock.mock.calls[0][2].aborted).toBe(true);
    await act(async () => { ai.resolve(completion("obsolete")); save.resolve(false); });
    expect(host.querySelector(".smart-capture-summary b")?.textContent).toBe("看书");
    expect(button.disabled).toBe(false);
  });

  it("does not replace recovered edits or request AI when disabled", async () => {
    const raw = "明天下午3点在图书馆看书";
    await act(async () => { root.render(<SmartCaptureDialog {...props({ raw, recovery: { raw, mode: "offline", updatedAt: Date.now(), drafts: [{ kind: "event", title: "恢复的修改", date: "2026-09-10", category: "学习", allDay: true }] } })} />); });
    expect(host.querySelector(".smart-capture-summary b")?.textContent).toBe("恢复的修改");
    expect(requestSmartCaptureMock).not.toHaveBeenCalled();
    await act(async () => { root.render(<SmartCaptureDialog {...props({ raw: "开会", aiPreferences: offlinePreferences })} />); });
    expect(host.querySelector(".smart-capture-summary b")?.textContent).toBe("开会");
    expect(requestSmartCaptureMock).not.toHaveBeenCalled();
  });

  it("does not let a previous capture finish over a replacement capture", async () => {
    const first = deferred<{ content: string }>(), second = deferred<{ content: string }>();
    requestSmartCaptureMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await act(async () => { root.render(<SmartCaptureDialog {...props()} />); });
    await act(async () => { root.render(<SmartCaptureDialog {...props({ raw: "开会" })} />); });
    await act(async () => { first.resolve(completion("obsolete")); });
    expect(host.querySelector(".smart-capture-summary b")?.textContent).toBe("开会");
    expect(host.textContent).toContain("AI 解析中");
    await act(async () => { second.resolve(completion("new")); });
    expect(host.querySelector(".smart-capture-summary b")?.textContent).toBe("new");
  });

  it("shows wake-up guidance after eight seconds without blocking offline saving", async () => {
    vi.useFakeTimers(); requestSmartCaptureMock.mockReturnValue(new Promise(() => {}));
    await act(async () => { root.render(<SmartCaptureDialog {...props()} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(host.textContent).toContain("模型唤醒中");
    expect(host.querySelector<HTMLButtonElement>("footer .primary-action")?.disabled).toBe(false);
  });
});


describe("compact capture presentation", () => {
  it.each(["zh", "en"] as const)("keeps AI beside source text and shows the selected category color and independent date/time fields in %s", async (locale) => {
    await act(async () => root.render(<SmartCaptureDialog {...props({ locale, raw: "明天10:00-11:30开会", aiPreferences: offlinePreferences })} />));
    const source = host.querySelector(".smart-capture-source-row")!;
    expect(source.querySelector(".smart-capture-raw")?.textContent).toContain("10:00-11:30");
    expect(source.querySelector("button")).toBeTruthy();
    expect(host.querySelector(".smart-capture-header p")).toBeNull();
    const badge = host.querySelector<HTMLElement>(".smart-capture-category")!;
    expect(badge.style.getPropertyValue("--category-color")).toMatch(/^#/);
    expect(badge.querySelector("i")).toBeTruthy();
    expect(host.querySelector(".smart-capture-summary small")?.textContent).toContain("10:00-11:30(1h 30m)");
    await act(async () => host.querySelector<HTMLButtonElement>(".smart-capture-summary")!.click());
    expect(host.querySelectorAll(".smart-capture-when > .smart-capture-when-field")).toHaveLength(4);
    expect(host.querySelectorAll(".smart-capture-when .glass-date-picker")).toHaveLength(2);
    expect(host.querySelectorAll(".smart-capture-when .glass-time-picker")).toHaveLength(2);
    await act(async () => host.querySelector<HTMLInputElement>(".smart-capture-all-day input")!.click());
    expect(host.querySelectorAll(".smart-capture-when > .smart-capture-when-field")).toHaveLength(2);
    await act(async () => host.querySelector<HTMLInputElement>(".smart-capture-all-day input")!.click());
    expect(host.querySelectorAll(".smart-capture-when > .smart-capture-when-field")).toHaveLength(4);
  });
});
