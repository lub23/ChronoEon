// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OperationHistoryRecord, SyncStore } from "@chronoeon/storage";
import { OperationHistory } from "./OperationHistory";
import { createDefaultSettings, type Entry } from "@chronoeon/domain";

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
  expect(host.querySelector(".recovery-list")?.textContent).toContain(locale === "zh" ? "标题Lunch→Dinner" : "TitleLunch→Dinner");
  expect(host.querySelector(".recovery-list")?.textContent).not.toContain(JSON.stringify({ title: "Dinner" }));
  expect(host.querySelector(".history-card-foot .recovery-action")).toBeTruthy();
  await act(async () => host.querySelector<HTMLButtonElement>(".history-card-foot .recovery-action")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>(".confirm-actions .primary-action")!.click());
  expect(journal.restoreHistory).toHaveBeenCalledWith("one");
  expect(restored).toHaveBeenCalledOnce();
});

it("unpacks settings changes into one readable row per setting", async () => {
  const settingsRecord: OperationHistoryRecord = {
    ...record, title: "settings", changes: [{
      table: "sync_settings", key: ["settings"],
      before: { payload_json: JSON.stringify({ "/settings/defaultCalendarID": "home", "/settings/bill/currency": "CNY" }) },
      after: { payload_json: JSON.stringify({ "/settings/defaultCalendarID": "work", "/settings/bill/currency": "CNY" }) },
    }],
  };
  await act(async () => root.render(<OperationHistory locale="zh" journal={store([settingsRecord]) as unknown as SyncStore} onRestored={vi.fn()} />));
  const details = host.querySelector(".history-details")!;
  expect(host.textContent).toContain("共享设置");
  expect(details.textContent).toContain("默认日历home→work");
  expect(details.textContent).not.toContain("payload_json");
  expect(details.textContent).not.toContain('{"');
});

it("moves overflow and history clearing into a compact dialog", async () => {
  const journal = store(records(6));
  await act(async () => root.render(<OperationHistory locale="en" journal={journal as unknown as SyncStore} onRestored={vi.fn()} />));
  expect(host.querySelectorAll(".recovery-list > li")).toHaveLength(5);
  await act(async () => host.querySelector<HTMLButtonElement>(".recovery-heading button")!.click());
  expect(document.querySelectorAll(".settings-modal .recovery-list > li")).toHaveLength(6);
  expect(document.querySelectorAll(".settings-modal .history-details")).toHaveLength(6);
  await act(async () => document.querySelector<HTMLButtonElement>(".settings-modal .danger-button")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>(".confirm-actions .danger-button")!.click());
  expect(journal.clearHistory).toHaveBeenCalledOnce();
});

it("summarizes calendar insertion without listing defaults or shifting existing catalogs", async () => {
  const calendars = createDefaultSettings("en").calendars;
  const next = [{ ...calendars[0], id: "new", name: "New calendar" }, ...calendars];
  const row = { ...record, changes: [{ table: "sync_settings", key: ["settings"], before: { payload_json: JSON.stringify({ "/settings/calendars": calendars }) }, after: { payload_json: JSON.stringify({ "/settings/calendars": next }) } }] };
  await act(async () => root.render(<OperationHistory locale="en" journal={store([row]) as unknown as SyncStore} onRestored={vi.fn()} />));
  expect(host.querySelectorAll(".history-diff")).toHaveLength(1);
  expect(host.querySelector(".history-diff")?.textContent).toContain("New calendar");
  expect(host.textContent).not.toContain("defaultCategoryId");
});

it("shows deletion metadata and an inspectable title without a full-field diff", async () => {
  const onPreview = vi.fn();
  const subject: Entry = { id: "one", kind: "event", title: "Dinner", date: "2026-10-04", start: "18:00", note: "Friends", category: "general", color: "#777", createdAt: record.createdAt };
  const deleted: OperationHistoryRecord = { ...record, action: "delete", subject: { type: "entry", value: subject }, changes: [{ table: "entries", key: ["one"], before: { title: "Dinner", date: "2026-10-04", start_time: "18:00", note: "Friends" }, after: null }] };
  await act(async () => root.render(<OperationHistory locale="en" journal={store([deleted]) as unknown as SyncStore} onRestored={vi.fn()} onPreview={onPreview} />));
  expect(host.querySelector(".history-summary")?.textContent).toContain("2026-10-04 18:00Friends");
  expect(host.querySelector(".history-details-toggle")).toBeNull();
  expect(host.textContent).not.toContain("fields");
  act(() => host.querySelector<HTMLButtonElement>(".history-title")!.click());
  expect(onPreview).toHaveBeenCalledWith(deleted);
  act(() => host.querySelector<HTMLButtonElement>(".recovery-heading button")!.click());
  expect(document.querySelector(".settings-modal-backdrop")?.parentElement).toBe(document.body);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })));
  expect(document.querySelector(".settings-modal")).toBeNull();
});

it("shows a language change as one local setting without catalog side effects", async () => {
 const row: OperationHistoryRecord = { ...record, title: "device_preferences", changes: [{ table: "device_preferences", key: ["language"], before: { language: "zh" }, after: { language: "en" } }] };
 await act(async () => root.render(<OperationHistory locale="zh" journal={store([row]) as unknown as SyncStore} onRestored={vi.fn()} />));
 expect(host.querySelectorAll(".history-diff")).toHaveLength(1);
 expect(host.textContent).toContain("本机设置");
 expect(host.querySelector(".history-diff")?.textContent).toContain("语言中文→English");
});
