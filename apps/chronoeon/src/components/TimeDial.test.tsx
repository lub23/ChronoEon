// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dialValueAt, TimeDial } from "./TimeDial";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

function pointer(face: SVGSVGElement, type: string, value: number, count: number, radius: number, pointerId = 1) {
  const angle = value / count * Math.PI * 2;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0,
    clientX: 20 + (144 + Math.sin(angle) * radius) / 2,
    clientY: 30 + (144 - Math.cos(angle) * radius) / 2 });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  act(() => face.dispatchEvent(event));
}

describe("concentric time dial", () => {
  it("rounds to all 24 hours and all 60 individual minutes around the full circle", () => {
    for (const count of [24, 60]) for (let value = 0; value < count; value += 1) {
      const angle = value / count * Math.PI * 2;
      expect(dialValueAt(Math.sin(angle), -Math.cos(angle), count)).toBe(value);
    }
    expect(dialValueAt(-0.001, -1, 60)).toBe(0);
    expect(dialValueAt(0.001, -1, 60)).toBe(0);
  });
  it("maps scaled touch coordinates, locks the selected ring, and releases cancelled gestures", () => {
    const onChange = vi.fn();
    function Dial() {
      const [value, setValue] = useState([9, 7]);
      return <TimeDial hour={value[0]} minute={value[1]} locale="zh" onChange={(hour, minute) => { setValue([hour, minute]); onChange(hour, minute); }} />;
    }
    act(() => root.render(<Dial />));
    const face = host.querySelector("svg")!;
    vi.spyOn(face, "getBoundingClientRect").mockReturnValue({ left: 20, top: 30, width: 144, height: 144 } as DOMRect);
    face.setPointerCapture = vi.fn(); face.hasPointerCapture = () => true; face.releasePointerCapture = vi.fn();
    pointer(face, "pointerdown", 23, 24, 76);
    expect(onChange).toHaveBeenLastCalledWith(23, 7);
    pointer(face, "pointerdown", 45, 60, 122, 2);
    pointer(face, "pointermove", 15, 60, 122, 2);
    expect(onChange).toHaveBeenCalledTimes(1);
    pointer(face, "pointermove", 6, 24, 122);
    expect(onChange).toHaveBeenLastCalledWith(6, 7);
    pointer(face, "pointercancel", 6, 24, 122);
    expect(face.releasePointerCapture).toHaveBeenCalledWith(1);
    pointer(face, "pointerdown", 59, 60, 122);
    expect(onChange).toHaveBeenLastCalledWith(6, 59);
    pointer(face, "pointermove", 0, 60, 122);
    expect(onChange).toHaveBeenLastCalledWith(6, 0);
    pointer(face, "pointerup", 0, 60, 122);
    pointer(face, "pointermove", 30, 60, 122);
    expect(onChange).toHaveBeenLastCalledWith(6, 0);
    expect(host.querySelector('[aria-label="小时"]')?.getAttribute("aria-valuenow")).toBe("6");
    expect(host.querySelector('[aria-label="分钟"]')?.getAttribute("aria-valuenow")).toBe("0");
  });
});
