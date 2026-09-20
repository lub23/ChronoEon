// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerModalDismiss } from "./modalLayer";

/** Android's back gesture: coarse pointer, one history entry per open modal. */
function emulateTouchDevice() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({ matches: query.includes("pointer: coarse"), media: query, addEventListener() {}, removeEventListener() {} })),
  });
}

describe("modal back-gesture bookkeeping", () => {
  const pushState = vi.spyOn(window.history, "pushState");
  const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
  beforeEach(() => { emulateTouchDevice(); pushState.mockClear(); back.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps a dialog open across the popstates produced by earlier programmatic backs", () => {
    const quickNote = vi.fn();
    const unregisterQuickNote = registerModalDismiss(quickNote);
    expect(pushState).toHaveBeenCalledTimes(1);

    // Quick Note hands off to Smart Capture in one commit, and the new dialog
    // re-registers twice (an AI request starts, the parent re-renders).
    unregisterQuickNote();
    const smartCapture = vi.fn((event: KeyboardEvent) => event.preventDefault());
    let unregister = registerModalDismiss(smartCapture);
    unregister(); unregister = registerModalDismiss(smartCapture);
    unregister(); unregister = registerModalDismiss(smartCapture);
    expect(back).toHaveBeenCalledTimes(3);

    // The three queued traversals arrive later, one popstate each.
    for (let i = 0; i < 3; i += 1) window.dispatchEvent(new PopStateEvent("popstate"));
    expect(smartCapture).not.toHaveBeenCalled();

    // A real system back reaches the dialog exactly once.
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(smartCapture).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("restores the consumed entry when a guarded dialog stays open", () => {
    vi.useFakeTimers();
    const guarded = vi.fn((event: KeyboardEvent) => event.preventDefault());
    const unregister = registerModalDismiss(guarded);
    pushState.mockClear();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(guarded).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(pushState).toHaveBeenCalledTimes(1);
    unregister();
    expect(back).toHaveBeenCalledTimes(1);
  });
});
