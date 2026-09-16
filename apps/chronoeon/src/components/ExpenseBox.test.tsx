// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { ExpenseBox } from "./ExpenseBox";

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

describe("ExpenseBox", () => {
  it("centers the month summary and shares the circular currency glyph", () => {
    act(() => {
      root.render(<ExpenseBox amount={100} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="month" />);
    });
    expect(host.querySelector(".expense-box--month .expense-badge svg circle")).toBeTruthy();
    expect(host.querySelector(".expense-box--month .expense-badge")?.textContent).toBe("100");
    expect(host.querySelector(".expense-box-icon")).toBeNull();
  });

  it("follows the month format in the all-day lane: circular glyph, no icon", () => {
    act(() => {
      root.render(<ExpenseBox amount={100} settings={DEFAULT_CHRONOEON_SETTINGS} locale="en" variant="calendar" />);
    });
    expect(host.querySelector(".expense-box-icon")).toBeNull();
    expect(host.querySelector(".expense-box--calendar .expense-badge svg circle")).toBeTruthy();
    expect(host.querySelector(".expense-badge")?.textContent).toBe("100");
  });
});
