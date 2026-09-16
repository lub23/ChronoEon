// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlassSelect } from "./GlassSelect";

let host: HTMLDivElement;
let root: Root;

const options = [
  { value: "income", label: "Income", color: "#fab27b", group: "Money" },
  { value: "salary", label: "Salary", color: "#90d7ec", group: "Money" },
  { value: "food", label: "Food", color: "#8f4b2e", group: "Daily" },
];

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

function render(onChange = vi.fn()) {
  act(() => {
    root.render(<GlassSelect ariaLabel="Category" value="income" options={options} onChange={onChange} />);
  });
  return onChange;
}

describe("GlassSelect", () => {
  it("renders selected value, grouped glass options and category colors", () => {
    render();
    const trigger = host.querySelector<HTMLButtonElement>(".glass-select-trigger")!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.textContent).toContain("Income");

    act(() => { trigger.click(); });
    const popup = document.querySelector(".glass-select-popup")!;
    expect(popup.getAttribute("style")).toContain("--popup-left");
    expect([...popup.querySelectorAll(".glass-select-heading")].map((node) => node.textContent)).toEqual(["Money", "Daily"]);
    expect(popup.querySelector('[aria-selected="true"]')?.textContent).toContain("Income");
    expect((popup.querySelector('[aria-selected="true"] b') as HTMLElement).style.background).toBe("rgb(250, 178, 123)");
  });

  it("supports keyboard selection and closes the popup", () => {
    const onChange = render();
    const trigger = host.querySelector<HTMLButtonElement>(".glass-select-trigger")!;
    act(() => { trigger.click(); });
    act(() => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
    expect(document.querySelector('[aria-activedescendant$="-option-1"]')).toBeTruthy();
    act(() => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(onChange).toHaveBeenCalledWith("salary");
    expect(document.querySelector(".glass-select-popup")?.closest("[inert]")).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

it("keeps multi-select open while independently toggling every checkbox with keyboard or pointer", () => {
  function Multi() {
    const [value, setValue] = useState(options.map(option => option.value));
    return <GlassSelect multiple value={value} options={options} onChange={setValue} ariaLabel="Categories" summaryLabel="Categories" />;
  }
  act(() => root.render(<Multi />));
  const trigger = host.querySelector<HTMLButtonElement>(".glass-select-trigger")!;
  act(() => trigger.click());
  expect(document.querySelector('[role="listbox"]')?.getAttribute("aria-multiselectable")).toBe("true");
  expect(document.querySelectorAll(".glass-select-checkbox.is-checked")).toHaveLength(3);
  act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
  expect(document.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(2);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const remaining = [...document.querySelectorAll<HTMLButtonElement>('[role="option"][aria-selected="true"]')];
  for (const option of remaining) act(() => option.click());
  expect(host.querySelector(".glass-select-count")?.textContent).toBe("0/3");
  expect(document.querySelectorAll(".glass-select-checkbox.is-checked")).toHaveLength(0);
  act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
