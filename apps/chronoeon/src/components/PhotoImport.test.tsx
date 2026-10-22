// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@chronoeon/domain";
import { AttachmentField } from "./AttachmentField";
import { ItemPhotoField } from "./ItemFields";

const { pick, release } = vi.hoisted(() => ({ pick: vi.fn(), release: vi.fn() }));
vi.mock("../platform/attachments", () => ({
  pickEntryAttachments: pick, releaseAttachment: release,
  resolveAttachmentUrl: async (reference: string) => reference,
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  pick.mockReset(); release.mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it.each(["entry", "item"])("merges %s photo imports into current state, deduplicates, and prevents parallel imports", async kind => {
  let finish!: (result: unknown) => void;
  pick.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const change = vi.fn();
  function Photos() {
    const [value, setValue] = useState(["data:old", "data:keep"]);
    const Field = kind === "entry" ? AttachmentField : ItemPhotoField;
    return <Field locale="en" settings={createDefaultSettings("en")} entryDate="2026-10-22" value={value}
      onChange={next => { change(next); setValue(next); }} />;
  }
  await act(async () => root.render(<Photos />));
  const add = host.querySelector<HTMLButtonElement>(".item-photo-actions .secondary-button")!;
  act(() => { add.click(); add.click(); });
  expect(pick).toHaveBeenCalledOnce();
  expect(add.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>(".attachment-remove, .item-photo-remove")!.click());
  expect(change).toHaveBeenLastCalledWith(["data:keep"]);
  await act(async () => finish({ picked: [{ reference: "data:new" }, { reference: "data:new" }, { reference: "data:keep" }], skipped: [] }));
  expect(change).toHaveBeenLastCalledWith(["data:keep", "data:new"]);
  expect(add.disabled).toBe(false);
});
