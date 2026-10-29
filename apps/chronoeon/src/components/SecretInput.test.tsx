// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SecretInput } from "./SecretInput";

it("copies and pastes exact text and can hide and reveal the edited value", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const clipboard = { readText: vi.fn(async () => "  exact password  "), writeText: vi.fn(async (_text: string) => {}) };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  function Example() { const [value, set] = useState(""); return <SecretInput locale="en" ariaLabel="Credential" value={value} onChange={set} />; }
  try {
    act(() => root.render(<Example />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Paste Credential"]')!.click());
    const input = host.querySelector("input")!;
    expect(input.value).toBe("  exact password  "); expect(input.type).toBe("text");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Copy Credential"]')!.click());
    expect(clipboard.writeText).toHaveBeenCalledWith("  exact password  ");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Hide"]')!.click()); expect(input.type).toBe("password");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Show"]')!.click()); expect(input.type).toBe("text");
    expect(input.value).toBe("  exact password  ");
  } finally { act(() => root.unmount()); host.remove(); }
});
