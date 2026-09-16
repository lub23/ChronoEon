// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearSmartCaptureRecovery, readSmartCaptureRecovery, SMART_CAPTURE_RECOVERY_KEY, writeSmartCaptureRecovery } from "./draftRecovery";

describe("smart capture draft recovery", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips safe preview drafts without unknown fields", () => {
    writeSmartCaptureRecovery({
      raw: "明天午餐",
      mode: "ai",
      drafts: [{ kind: "bill", title: "午餐", date: "2026-08-08", category: "饮食/正餐", amount: -36, allDay: false, apiKey: "drop" } as never],
    });
    const recovered = readSmartCaptureRecovery(Date.now() + 10);
    expect(recovered?.mode).toBe("ai");
    expect(recovered?.drafts[0]).toMatchObject({ title: "午餐", amount: -36 });
    expect(recovered?.drafts[0]).not.toHaveProperty("apiKey");
  });

  it("expires stale sessions and clears them explicitly", () => {
    window.localStorage.setItem(SMART_CAPTURE_RECOVERY_KEY, JSON.stringify({ raw: "old", mode: "offline", drafts: [], updatedAt: 1 }));
    expect(readSmartCaptureRecovery(Date.now())).toBeNull();
    writeSmartCaptureRecovery({ raw: "new", mode: "offline", drafts: [] });
    clearSmartCaptureRecovery();
    expect(window.localStorage.getItem(SMART_CAPTURE_RECOVERY_KEY)).toBeNull();
  });
});
