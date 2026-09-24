// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GlassTimePicker } from "./GlassDateTimePicker";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => undefined;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("GlassTimePicker", () => {
  it("is the mobile dial on every device, with no text field to keep in sync", async () => {
    let committed: string | undefined;
    let current = "09:00";
    function StatefulTimePicker() {
      const [value, setValue] = useState(current);
      return (
        <GlassTimePicker
          value={value}
          locale="zh"
          ariaLabel="开始"
          onChange={(next) => {
            committed = next;
            current = next ?? "";
            setValue(next ?? "");
          }}
        />
      );
    }
    act(() => {
      root.render(<StatefulTimePicker />);
    });
    expect(host.querySelector(".glass-time-input")).toBeNull();
    const trigger = host.querySelector<HTMLButtonElement>(".glass-time-trigger")!;
    expect(trigger.textContent).toContain("09:00");

    await act(async () => { trigger.click(); });
    const popup = document.querySelector(".glass-picker-popup--dial");
    expect(popup).toBeTruthy();
    const hours = popup!.querySelector<SVGGElement>('[role="slider"][aria-label="小时"]')!;
    const minutes = popup!.querySelector<SVGGElement>('[role="slider"][aria-label="分钟"]')!;
    expect(hours.getAttribute("aria-valuenow")).toBe("9");
    expect(minutes.getAttribute("aria-valuenow")).toBe("0");

    await act(async () => { hours.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })); });
    expect(committed).toBe("10:00");
    await act(async () => { minutes.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })); });
    expect(committed).toBe("10:01");
    expect(host.querySelector<HTMLButtonElement>(".glass-time-trigger")!.textContent).toContain("10:01");
  });
});
