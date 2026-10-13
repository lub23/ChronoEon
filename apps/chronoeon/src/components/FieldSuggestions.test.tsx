// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FieldSuggestions, locationFieldCandidates } from "./FieldSuggestions";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("ranks title history and recent places but filters by segmented user input", () => {
  const history = Array.from({ length: 8 }, (_, i) => ({ kind: "event" as const, title: i === 0 ? "Travel" : "Rest", category: "", location: i === 0 ? "辽宁开原酒店" : `Hotel ${i}`, date: `2026-10-0${i + 1}` }));
  expect(locationFieldCandidates("Travel", "", history, "2026-10-08")[0].value).toBe("辽宁开原酒店");
  expect(locationFieldCandidates("", "", history, "2026-10-08")[0].value).toBe("Hotel 7");
  expect(locationFieldCandidates("", "", history, "2026-10-08")).toHaveLength(8);
  expect(locationFieldCandidates("Rest", "辽宁酒店", history, "2026-10-08")).toEqual([{ value: "辽宁开原酒店" }]);
});

it("portals all candidates, keeps keyboard selection across rerenders and respects composition", async () => {
  const selected = vi.fn();
  function Input() {
    const ref = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState("");
    return <div style={{ overflow: "hidden" }}><input ref={ref} value={value} onChange={event => setValue(event.target.value)} /><FieldSuggestions inputRef={ref} locale="en" suggestions={Array.from({ length: 9 }, (_, i) => ({ value: `Hotel ${i}` }))} onSelect={value => { selected(value); setValue(value); }} /></div>;
  }
  act(() => root.render(<Input />));
  const input = host.querySelector("input")!;
  act(() => input.focus());
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(9);
  for (let i = 0; i < 6; i++) act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  expect(document.querySelector('[aria-selected="true"]')?.textContent).toBe("Hotel 6");
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
  expect(selected).not.toHaveBeenCalled();
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(selected).toHaveBeenCalledWith("Hotel 6");
});

it("highlights fragments and stays inside a keyboard-reduced visual viewport", () => {
  const viewport = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 50, width: 390, height: 300 });
  vi.stubGlobal("visualViewport", viewport);
  function Input() {
    const ref = useRef<HTMLInputElement>(null);
    return <><input ref={ref} /><FieldSuggestions inputRef={ref} locale="zh" query="辽宁酒店" suggestions={[{ value: "辽宁开原酒店" }]} onSelect={vi.fn()} /></>;
  }
  act(() => root.render(<Input />));
  const input = host.querySelector("input")!;
  vi.spyOn(input, "getBoundingClientRect").mockReturnValue({ left: 260, right: 380, top: 290, bottom: 322, width: 120, height: 32 } as DOMRect);
  act(() => input.focus());
  expect([...document.querySelectorAll("mark")].map(value => value.textContent).join("")).toBe("辽宁酒店");
  const popup = document.querySelector<HTMLElement>(".field-suggestion-anchor")!;
  expect(parseFloat(popup.style.top)).toBeLessThan(290);
  expect(parseFloat(popup.style.left) + parseFloat(popup.style.width)).toBeLessThanOrEqual(382);
  act(() => { viewport.height = 180; viewport.dispatchEvent(new Event("resize")); });
  expect(parseFloat(popup.style.top) + parseFloat(popup.style.maxHeight)).toBeLessThanOrEqual(222);
});
