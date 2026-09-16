// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttachmentThumb } from "./AttachmentThumb";
const { resolveUrl } = vi.hoisted(() => ({ resolveUrl: vi.fn() }));
vi.mock("../platform/attachments", () => ({ resolveAttachmentUrl: resolveUrl }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); resolveUrl.mockReset(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("shows loading until resolution, and reports failed resolution without an unhandled rejection", async () => {
  let reject!: (error: Error) => void;
  resolveUrl.mockReturnValue(new Promise((_resolve, no) => { reject = no; }));
  await act(async () => { root.render(<AttachmentThumb locale="zh" reference="att:1" />); });
  expect(host.querySelector(".is-loading")).not.toBeNull(); expect(host.querySelector(".is-missing")).toBeNull();
  await act(async () => { reject(new Error("missing")); });
  expect(host.querySelector(".is-missing")).not.toBeNull();
});
it("clears the previous image while a different reference is loading", async () => {
  resolveUrl.mockResolvedValueOnce("blob:old").mockReturnValueOnce(new Promise(() => {}));
  await act(async () => { root.render(<AttachmentThumb locale="en" reference="att:1" />); });
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:old");
  await act(async () => { root.render(<AttachmentThumb locale="en" reference="att:2" />); });
  expect(host.querySelector("img")).toBeNull(); expect(host.querySelector(".is-loading")).not.toBeNull();
});
