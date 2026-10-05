// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OperationHistoryRecord, SyncStore } from "@chronoeon/storage";
import { OperationHistory } from "./OperationHistory";

let root: Root, host: HTMLDivElement;
const record: OperationHistoryRecord = {
  id: "one", createdAt: "2026-10-04T10:00:00Z", restoredFrom: null, action: "update", title: "Lunch",
  changes: [{ table: "entries", key: ["one"], before: { title: "Lunch" }, after: { title: "Dinner" } }],
};
function records(count: number) { return Array.from({ length: count }, (_, index) => ({ ...record, id: `record-${index}` })); }
function store(rows: OperationHistoryRecord[] = [record]) {
  return {
    history: vi.fn(async () => rows), subscribe: vi.fn(() => () => {}),
    restoreHistory: vi.fn(async () => {}), clearHistory: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it.each(["zh", "en"] as const)("renders only changed fields and confirms restoration in %s", async locale => {
  const journal = store(), restored = vi.fn(async () => {});
  await act(async () => root.render(<OperationHistory locale={locale} journal={journal as unknown as SyncStore} onRestored={restored} />));
  expect(host.querySelector(".recovery-list")?.textContent).toContain("Dinner");
  expect(host.querySelector(".recovery-list")?.textContent).toContain(locale === "zh" ? "标题Lunch → Dinner" : "TitleLunch → Dinner");
  expect(host.querySelector(".recovery-list")?.textContent).not.toContain(JSON.stringify({ title: "Dinner" }));
  await act(async () => host.querySelector<HTMLButtonElement>(".recovery-action")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>(".confirm-actions .primary-action")!.click());
  expect(journal.restoreHistory).toHaveBeenCalledWith("one");
  expect(restored).toHaveBeenCalledOnce();
});

it("moves overflow and history clearing into a compact dialog", async () => {
  const journal = store(records(6));
  await act(async () => root.render(<OperationHistory locale="en" journal={journal as unknown as SyncStore} onRestored={vi.fn()} />));
  expect(host.querySelectorAll(".recovery-list > li")).toHaveLength(5);
  await act(async () => host.querySelector<HTMLButtonElement>(".recovery-heading button")!.click());
  expect(document.querySelectorAll(".settings-modal .recovery-list > li")).toHaveLength(6);
  await act(async () => document.querySelector<HTMLButtonElement>(".settings-modal .danger-button")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>(".confirm-actions .danger-button")!.click());
  expect(journal.clearHistory).toHaveBeenCalledOnce();
});
