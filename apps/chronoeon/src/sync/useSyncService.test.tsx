// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SyncStore } from "@chronoeon/storage";
import { useSyncService } from "./useSyncService";
import { DEFAULT_SYNC_CONFIG } from "./types";

vi.mock("./client", () => ({
  NativeSyncBackend: class { readonly id: string; constructor(config: { gitRemote: string }) { this.id = config.gitRemote; } },
  prepareAttachmentImports: vi.fn(async () => {}),
}));
let host: HTMLDivElement, root: Root, current: ReturnType<typeof useSyncService>;
const journal = {
  status: vi.fn(async (backend: string) => ({ pending: 0, conflicts: 0, failures: 0, nextAttempt: 0, lastSuccess: null, lastError: null, missingAttachments: 0,
    lastSnapshotAt: backend === "remote-A" ? "2026-09-09T08:00:00.000Z" : null,
    nextSnapshotAt: backend === "remote-A" ? "2026-09-16T08:00:00.000Z" : null })),
  subscribe: vi.fn(() => vi.fn()), flush: vi.fn(async () => {}), getSettings: vi.fn(async () => null),
  conflicts: vi.fn(async () => []), missingAttachmentDetails: vi.fn(async () => []),
};
const settings = {}, callbacks = { importSettings: vi.fn(), onApplied: vi.fn(async () => {}), onConflicts: vi.fn() };
function Harness({ remote }: { remote: string }) {
  current = useSyncService(journal as unknown as SyncStore, { ...DEFAULT_SYNC_CONFIG, gitRemote: remote }, settings, callbacks);
  return null;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("refreshes the schedule for the selected destination rather than retaining the previous endpoint's deadline", async () => {
  await act(async () => { root.render(<Harness remote="remote-A" />); });
  expect(current.status?.nextSnapshotAt).toBe("2026-09-16T08:00:00.000Z");
  await act(async () => { root.render(<Harness remote="remote-B" />); });
  expect(journal.status).toHaveBeenLastCalledWith("remote-B");
  expect(current.status?.nextSnapshotAt).toBeNull();
  await act(async () => { root.render(<Harness remote="remote-A" />); });
  expect(current.status?.nextSnapshotAt).toBe("2026-09-16T08:00:00.000Z");
});
