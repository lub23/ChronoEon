// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePersistentPreference } from "./usePersistentPreference";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); localStorage.clear(); });
function Preference() {
  const [value, setValue] = usePersistentPreference("test", "month");
  return <button onClick={() => setValue("week")}>{value}</button>;
}
it("keeps the interface usable when reading and writing preferences are denied", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  act(() => root.render(<Preference />));
  expect(host.textContent).toBe("month");
  act(() => host.querySelector("button")!.click());
  expect(host.textContent).toBe("week");
});
it("reads and persists the current product key only", () => {
  localStorage.setItem("chronoeon.preference.test", '"day"');
  localStorage.setItem("chronicle.preference.test", '"obsolete"');
  act(() => root.render(<Preference />));
  expect(host.textContent).toBe("day");
  act(() => host.querySelector("button")!.click());
  expect(localStorage.getItem("chronoeon.preference.test")).toBe('"week"');
});
