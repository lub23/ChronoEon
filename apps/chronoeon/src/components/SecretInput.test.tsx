// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { SecretInput } from "./SecretInput";

it("starts hidden, edits exact text natively, and reveals without losing the value", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  function Example() { const [value, set] = useState(""); return <SecretInput locale="en" ariaLabel="Credential" value={value} onChange={set} />; }
  try {
    act(() => root.render(<Example />));
    const input = host.querySelector("input")!;
    expect(input.type).toBe("password"); expect(host.querySelectorAll("button")).toHaveLength(1);
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  exact password  "); input.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Show"]')!.click()); expect(input.type).toBe("text");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Hide"]')!.click()); expect(input.type).toBe("password");
    expect(input.value).toBe("  exact password  ");
  } finally { act(() => root.unmount()); host.remove(); }
});
