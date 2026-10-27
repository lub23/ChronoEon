// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SyncStore } from "@chronoeon/storage";
import { AttachmentMaintenance } from "./AttachmentMaintenance";

const mocks = vi.hoisted(() => ({ prune: vi.fn() }));
vi.mock("../platform/attachments", () => ({ pruneUnreferencedAttachments: mocks.prune }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  mocks.prune.mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const journal = { maintainAttachments: vi.fn(async (collect: (hashes: string[]) => Promise<unknown>) => collect(["a".repeat(64)])) } as unknown as SyncStore;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

it("previews unused photos and only deletes after confirmation", async () => {
  mocks.prune.mockResolvedValueOnce({ files: 2, bytes: 2048 }).mockResolvedValueOnce({ files: 2, bytes: 2048 });
  const onChanged = vi.fn();
  act(() => root.render(<AttachmentMaintenance locale="en" journal={journal} onChanged={onChanged} />));
  await act(async () => host.querySelector<HTMLButtonElement>(".settings-data-block button")!.click());
  await flush();
  expect(mocks.prune).toHaveBeenNthCalledWith(1, ["a".repeat(64)], 24 * 60 * 60 * 1000, false);
  expect(document.querySelector("#confirm-detail")?.textContent).toBe("2 files · 2 KB");
  await act(async () => document.querySelector<HTMLButtonElement>(".confirm-actions .danger-button")!.click());
  await flush();
  expect(mocks.prune).toHaveBeenNthCalledWith(2, ["a".repeat(64)], 24 * 60 * 60 * 1000, true);
  expect(host.textContent).toContain("Removed 2 files · 2 KB");
  expect(onChanged).toHaveBeenCalledOnce();
});

it("reports when nothing is unreferenced", async () => {
  mocks.prune.mockResolvedValueOnce({ files: 0, bytes: 0 });
  act(() => root.render(<AttachmentMaintenance locale="en" journal={journal} />));
  await act(async () => host.querySelector<HTMLButtonElement>(".settings-data-block button")!.click());
  await flush();
  expect(mocks.prune).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("No unused photos to clean.");
  expect(document.querySelector(".confirm-sheet")).toBeNull();
});