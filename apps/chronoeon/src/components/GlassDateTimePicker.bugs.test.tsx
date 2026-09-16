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
  it("accepts exact minutes in the field and opens a cyclic wheel from the icon", async () => {
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
    const input = host.querySelector<HTMLInputElement>(".glass-time-input")!;
    expect(input).toBeTruthy();
    expect(input.step).toBe("60");
    expect(input.value).toBe("09:00");

    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, "09:07");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(committed).toBe("09:07");

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".glass-time-toggle")!.click();
    });
    const popup = document.querySelector(".glass-picker-popup--time");
    expect(popup).toBeTruthy();
    expect(popup?.querySelector(".glass-time-entry")).toBeNull();
    expect([...popup!.querySelectorAll(".glass-time-column")].map((column) => column.getAttribute("aria-label")))
      .toEqual(["小时", "分钟"]);

    const hourButton = [...popup!.querySelectorAll<HTMLButtonElement>(".glass-time-column > div button")]
      .find((button) => button.textContent === "10")!;
    await act(async () => { hourButton.click(); });
    expect(committed).toBe("10:07");
  });
});
