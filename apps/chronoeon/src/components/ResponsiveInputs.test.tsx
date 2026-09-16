// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TagInput } from "./TagInput";
import { GlassTimePicker } from "./GlassDateTimePicker";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });
function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("responsive inputs", () => {
  it("searches existing tags without losing the unfinished token or delimiter", () => {
    const onChange = vi.fn();
    function Tags() { const [value, setValue] = useState<string[]>(); return <TagInput value={value} available={["工作", "工作/项目", "日记"]} locale="zh" onChange={(next) => { setValue(next); onChange(next); }} />; }
    act(() => root.render(<Tags />));
    const input = host.querySelector("input")!;
    act(() => input.focus()); type(input, "日记, 工");
    expect(input.value).toBe("日记, 工");
    expect([...host.querySelectorAll('[role="option"]')].map((el) => el.textContent)).toEqual(["#工作", "#工作/项目"]);
    act(() => host.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    expect(input.value).toBe("日记, 工作, ");
    expect(onChange).toHaveBeenLastCalledWith(["日记", "工作"]);
    type(input, "日记, 工作, 新标签");
    expect(onChange).toHaveBeenLastCalledWith(["日记", "工作", "新标签"]);
  });
  it("selects a suggestion with Enter rather than submitting the composer", () => {
    const submit = vi.fn((event) => event.preventDefault());
    function Tags() { const [value, setValue] = useState<string[]>(); return <form onSubmit={submit}><TagInput value={value} available={["alpha", "beta"]} locale="en" onChange={setValue} /></form>; }
    act(() => root.render(<Tags />));
    const input = host.querySelector("input")!;
    act(() => input.focus()); type(input, "al");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(input.value).toBe("alpha, "); expect(submit).not.toHaveBeenCalled();
  });
  it("uses independent radial hour/minute controls instead of lists on touch devices", async () => {
    function Time() { const [value, setValue] = useState<string | undefined>("09:07"); return <GlassTimePicker value={value} onChange={setValue} locale="en" ariaLabel="Time" />; }
    act(() => root.render(<Time />));
    act(() => host.querySelector<HTMLButtonElement>(".glass-time-trigger")!.click());
    expect(document.querySelector(".glass-picker-popup select, .glass-picker-popup [role=listbox], input[type=time]")).toBeNull();
    const hours = document.querySelector('[role="slider"][aria-label="Hour"]')!;
    const minutes = document.querySelector('[role="slider"][aria-label="Minute"]')!;
    await act(async () => { await new Promise(requestAnimationFrame); });
    expect(document.activeElement).toBe(hours);
    expect([...document.querySelectorAll(".time-dial [role=slider]")].map(el => el.getAttribute("aria-label"))).toEqual(["Hour", "Minute"]);
    expect(hours.getAttribute("aria-valuemax")).toBe("23");
    expect(minutes.getAttribute("aria-valuemax")).toBe("59");
    act(() => hours.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
    expect(host.textContent).toContain("23:07");
    act(() => minutes.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
    expect(host.textContent).toContain("23:59");
    act(() => minutes.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })));
    expect(host.textContent).toContain("23:00");
    act(() => [...document.querySelectorAll<HTMLButtonElement>(".time-dial-actions button")].find(button => button.textContent === "Done")!.click());
    expect(document.querySelector(".time-dial")?.closest("[inert]")).not.toBeNull();
    expect(document.activeElement).toBe(host.querySelector(".glass-time-trigger"));
  });
});
