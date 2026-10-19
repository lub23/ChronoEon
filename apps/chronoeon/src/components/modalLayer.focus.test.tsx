// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFocusTrap } from "./modalLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Sheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref);
  return (
    <section ref={ref}>
      <button type="button">first</button>
      <button type="button">last</button>
      <button type="button" onClick={onClose}>close</button>
    </section>
  );
}

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open</button>
      {open && <Sheet onClose={() => setOpen(false)} />}
    </>
  );
}

describe("focus trap", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
  const pressTab = (shiftKey = false) => act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }));
  });

  it("wraps Tab inside the dialog and returns focus to the trigger", () => {
    act(() => root.render(<Host />));
    const trigger = button("open");
    trigger.focus();
    act(() => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const first = button("first");
    const close = button("close");
    expect(document.activeElement).toBe(first);

    close.focus();
    pressTab();
    expect(document.activeElement).toBe(first);

    first.focus();
    pressTab(true);
    expect(document.activeElement).toBe(close);

    act(() => button("close").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.activeElement).toBe(trigger);
  });
});