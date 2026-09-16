// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickNoteDialog } from "./QuickNoteDialog";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(onParse = vi.fn(), onManualAdd = vi.fn()) {
  act(() => root.render(
    <QuickNoteDialog locale="zh" onParse={onParse} onManualAdd={onManualAdd} onClose={onClose} />,
  ));
}
const onClose = vi.fn();

describe("Quick Note", () => {
  it("keeps only text entry and manual handoff", () => {
    const manual = vi.fn();
    render(vi.fn(), manual);
    expect(document.body.textContent).not.toContain("开始说话");
    expect(document.body.textContent).not.toContain("配置 AI");
    expect(document.querySelector(".quick-note-mic")).toBeNull();
    expect(document.querySelector(".quick-note-modes")).toBeNull();
    expect(document.querySelector(".quick-note-head > svg")).toBeNull();

    const input = document.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "明天开会");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => document.querySelector<HTMLButtonElement>(".quick-note-manual")!.click());
    expect(manual).toHaveBeenCalledWith("明天开会");
  });

  it("does not parse empty text", () => {
    const parse = vi.fn();
    render(parse);
    act(() => document.querySelector<HTMLButtonElement>(".primary-action")!.click());
    expect(parse).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("请先写点什么");
  });

  it("closes from its own dialog control and parses text through the parent", () => {
    const parse = vi.fn();
    render(parse);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    const input = document.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "明天 14:00 开会");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => document.querySelector<HTMLButtonElement>(".primary-action")!.click());
    expect(parse).toHaveBeenCalledWith("明天 14:00 开会");
  });
});
