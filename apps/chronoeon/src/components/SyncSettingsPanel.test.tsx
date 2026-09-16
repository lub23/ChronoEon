// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "../sync/types";
import { SyncSettingsPanel } from "./SyncSettingsPanel";

type Service = ComponentProps<typeof SyncSettingsPanel>["service"];
let host: HTMLDivElement, root: Root;
const success = { ok: true as const, sent: 0, received: 0, conflicts: 0, snapshotCreated: true, attachmentCount: 0 };
function service(patch: Partial<Service> = {}): Service {
  return {
    available: true, busy: false, result: null, conflicts: [], missingAttachments: [],
    status: { pending: 0, conflicts: 0, failures: 0, nextAttempt: 0, lastSuccess: "2026-09-09T08:00:00.000Z", lastError: null, missingAttachments: 0, lastSnapshotAt: "2026-09-09T08:00:00.000Z", nextSnapshotAt: "2026-09-16T08:00:00.000Z" },
    run: vi.fn(async () => success), rebuildSnapshot: vi.fn(async () => success), resolve: vi.fn(async () => {}), removeMissingAttachment: vi.fn(async () => {}), clearMissingAttachments: vi.fn(async () => {}), ...patch,
  };
}
function render(sync: Service, locale: "en" | "zh" = "zh", configured = true) {
  root.render(<SyncSettingsPanel locale={locale} config={{ ...DEFAULT_SYNC_CONFIG, gitRemote: configured ? "https://example.test/sync.git" : "" }} service={sync} entries={[]} onChange={vi.fn()} />);
}
const rebuildButton = () => host.querySelector<HTMLButtonElement>(".sync-rebuild-button")!;
const confirmation = () => document.querySelector<HTMLElement>('[role="alertdialog"]')!;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("snapshot rebuild settings", () => {
  it.each(["zh", "en"] as const)("shows the persisted next rebuild time and seven-day retention in %s", (locale) => {
    act(() => render(service(), locale));
    expect(host.querySelector(".sync-snapshot-schedule time")?.getAttribute("datetime")).toBe("2026-09-16T08:00:00.000Z");
    expect(host.textContent).toContain(locale === "zh" ? "每 7 天" : "every 7 days");
    expect(rebuildButton().textContent).toContain(locale === "zh" ? "立即重建快照" : "Rebuild snapshot now");
  });

  it("asks for destructive confirmation in a viewport portal and cancelling does nothing", async () => {
    const sync = service(); act(() => render(sync));
    await act(async () => { rebuildButton().click(); });
    expect(confirmation().textContent).toContain("永久清空，无法恢复");
    expect(confirmation().textContent).toContain("7 天");
    expect(confirmation().parentElement?.parentElement).toBe(document.body);
    expect(sync.rebuildSnapshot).not.toHaveBeenCalled();
    await act(async () => { confirmation().querySelector<HTMLButtonElement>(".secondary-button")!.click(); });
    expect(sync.rebuildSnapshot).not.toHaveBeenCalled(); expect(rebuildButton().disabled).toBe(false);
  });

  it("rebuilds exactly once after confirmation and reports success only when confirmed", async () => {
    let finish!: (value: typeof success) => void;
    const rebuildSnapshot = vi.fn(() => new Promise<typeof success>((resolve) => { finish = resolve; }));
    const sync = service({ rebuildSnapshot }); act(() => render(sync));
    await act(async () => { rebuildButton().click(); });
    await act(async () => { const yes = confirmation().querySelector<HTMLButtonElement>(".danger-button")!; yes.click(); yes.click(); });
    expect(rebuildSnapshot).toHaveBeenCalledTimes(1); expect(rebuildButton().disabled).toBe(true);
    expect(host.textContent).not.toContain("快照已重建");
    await act(async () => { finish(success); });
    expect(host.textContent).toContain("快照已重建，本周期的回收站条目已清空");
  });

  it("does not announce cleared recovery after a failed rebuild", async () => {
    const sync = service({ rebuildSnapshot: vi.fn(async () => ({ ok: false as const, code: "SYNC_OFFLINE", message: "offline" })) });
    act(() => render(sync));
    await act(async () => { rebuildButton().click(); });
    await act(async () => { confirmation().querySelector<HTMLButtonElement>(".danger-button")!.click(); });
    expect(host.textContent).toContain("快照重建未确认完成"); expect(host.textContent).not.toContain("本周期的回收站条目已清空");
  });

  it.each(["busy", "unavailable", "unconfigured"])("disables rebuild while %s", (reason) => {
    const sync = service({ busy: reason === "busy", available: reason !== "unavailable" });
    act(() => render(sync, "en", reason !== "unconfigured")); expect(rebuildButton().disabled).toBe(true);
  });

  it("shows overdue guidance rather than moving an offline deadline forward", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-17T08:00:00.000Z")); act(() => render(service()));
    expect(host.textContent).toContain("已到期"); expect(host.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-16T08:00:00.000Z");
  });

  it("does not invent a deadline before the first successful snapshot", () => {
    act(() => render(service({ status: null }))); expect(host.querySelector("time")).toBeNull(); expect(host.textContent).toContain("首次成功同步时创建");
  });
});
