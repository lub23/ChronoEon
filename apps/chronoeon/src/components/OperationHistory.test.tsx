// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SyncStore } from "@chronoeon/storage";
import { OperationHistory } from "./OperationHistory";

let root: Root, host: HTMLDivElement;
const record = { id: "one", createdAt: "2026-10-04T10:00:00Z", action: "update", title: "Lunch", changes: [{ table: "entries", before: { title: "Lunch" }, after: { title: "Dinner" } }] };
const journal = () => ({ history: vi.fn(async () => [record]), subscribe: vi.fn(() => () => {}), restoreHistory: vi.fn(async () => {}), clearHistory: vi.fn(async () => {}) });
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it.each(["zh", "en"] as const)("renders bilingual history and confirms restoration in %s", async locale => {
  const store = journal(), restored = vi.fn(async () => {});
  await act(async () => root.render(<OperationHistory locale={locale} journal={store as unknown as SyncStore} onRestored={restored} />));
  expect(host.textContent).toContain(locale === "zh" ? "保留最近 7 天" : "Last 7 days");
  expect(host.querySelector("details")?.textContent).toContain("Dinner");
  await act(async () => host.querySelector<HTMLButtonElement>(".operation-history-row button")!.click());
  expect(store.restoreHistory).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>(".confirm-actions .primary-action")!.click());
  expect(store.restoreHistory).toHaveBeenCalledWith("one");
  expect(restored).toHaveBeenCalledOnce();
});
it("clears only history and reports changed-state conflicts without refreshing data", async () => {
  const store = journal(), restored = vi.fn(async () => {});
  store.restoreHistory.mockRejectedValueOnce(new Error("HISTORY_CHANGED"));
  await act(async () => root.render(<OperationHistory locale="en" journal={store as unknown as SyncStore} onRestored={restored} />));
  await act(async () => host.querySelector<HTMLButtonElement>(".operation-history-row button")!.click());
  await act(async () => host.querySelector<HTMLButtonElement>(".confirm-actions .primary-action")!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Nothing was overwritten");
  expect(restored).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>(".operation-history-heading button")!.click());
  expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain("recycle bin are not affected");
  await act(async () => host.querySelector<HTMLButtonElement>(".confirm-actions .danger-button")!.click());
  expect(store.clearHistory).toHaveBeenCalledOnce();
  expect(restored).not.toHaveBeenCalled();
});
