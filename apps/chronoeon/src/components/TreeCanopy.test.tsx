// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TreeCanopy } from "./TreeCanopy";

let host: HTMLDivElement;
let root: Root;

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

describe("TreeCanopy", () => {
  it("renders a pointer-transparent, deterministic crown with foliage", () => {
    let leaves = 0;
    act(() => { root.render(<TreeCanopy />); });
    leaves = host.querySelectorAll(".canopy-stage ellipse").length;
    expect(host.querySelector(".canopy-stage")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelectorAll(".canopy-back, .canopy-mid, .canopy-front").length).toBe(3);
    expect(leaves).toBeGreaterThan(0);

    act(() => { root.render(<TreeCanopy />); });
    expect(host.querySelectorAll(".canopy-stage ellipse").length).toBe(leaves);
  });
});
