// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@chronoeon/domain";
import { CalendarCatalogManager } from "./CalendarCatalogManager";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
it.each([true, false])("validates and trims names on Enter; respects Chinese composition (creating=%s)", creating => {
  const calendars = createDefaultSettings("zh").calendars;
  const change = vi.fn();
  act(() => root.render(<CalendarCatalogManager locale="zh" label="日历" calendars={calendars} defaultCalendarId={calendars[0].id}
    onChange={change} onDelete={vi.fn()} onSetDefault={vi.fn()} />));
  act(() => host.querySelector<HTMLButtonElement>(creating ? ".category-add" : ".category-edit-button")!.click());
  const input = document.querySelector<HTMLInputElement>(".category-name-input")!;
  const type = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const enter = (isComposing = false) => act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing, bubbles: true, cancelable: true })));
  type("   "); enter();
  expect(change).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLButtonElement>(".calendar-editor-dialog .primary-action")!.disabled).toBe(true);
  type("  工作日历  "); enter(true);
  expect(change).not.toHaveBeenCalled();
  enter();
  expect(change).toHaveBeenCalledOnce();
  expect(change.mock.calls[0][0].some((calendar: { name: string }) => calendar.name === "工作日历")).toBe(true);
});
