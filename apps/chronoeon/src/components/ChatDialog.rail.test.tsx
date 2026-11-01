// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@chronoeon/domain";
import { createMemoryConversationStore } from "../ai/memoryConversationStore";
import { ChatDialog } from "./ChatDialog";

let host: HTMLDivElement;
let root: Root;
const originalMatchMedia = window.matchMedia;

/** A phone-sized surface: the history rail becomes a drawer over the thread. */
function stubNarrowSurface() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true, writable: true,
    value: (query: string) => ({ matches: query === "(max-width: 900px)", media: query, addEventListener() {}, removeEventListener() {} }),
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  stubNarrowSurface();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: originalMatchMedia });
});

function render() {
  act(() => {
    root.render(
      <ChatDialog
        locale="zh"
        entries={[]}
        aiPreferences={{ enabled: true, providers: [], activeProviderId: null, ask: { thinking: false, mode: "ai" }, capture: { mode: "offline" } }}
        conversations={createMemoryConversationStore()}
        settings={createDefaultSettings()}
        initialMode="capture"
        onOpenEntry={() => undefined}
        onConfirmCapture={vi.fn(async () => true)}
        onOpenManualCapture={() => undefined}
        onOpenSettings={() => undefined}
        onClose={() => undefined}
      />,
    );
  });
}

function swipe(target: Element, fromX: number, toX: number) {
  act(() => { target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId: 7, isPrimary: true, clientX: fromX, clientY: 200 })); });
  act(() => { target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 7, isPrimary: true, clientX: toX, clientY: 206 })); });
}

describe("history drawer on a narrow surface", () => {
  it("opens from the header toggle and closes from a tap on the thread", async () => {
    render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(host.querySelector(".chat-rail.is-collapsed")).not.toBeNull();
    expect(host.querySelector(".chat-rail-scrim")).toBeNull();

    act(() => { host.querySelector<HTMLButtonElement>(".chat-rail-toggle")!.click(); });
    expect(host.querySelector(".chat-rail.is-overlay.is-open")).not.toBeNull();
    const scrim = host.querySelector<HTMLDivElement>(".chat-rail-scrim");
    expect(scrim).not.toBeNull();

    act(() => { scrim!.click(); });
    expect(host.querySelector(".chat-rail.is-overlay.is-open")).toBeNull();
    expect(host.querySelector(".chat-rail-scrim")).toBeNull();
  });

  it("wakes the drawer with a right swipe over the conversation and puts it away with a left swipe", async () => {
    render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    const thread = host.querySelector(".chat-thread")!;

    swipe(thread, 30, 140);
    expect(host.querySelector(".chat-rail.is-overlay.is-open")).not.toBeNull();

    swipe(host.querySelector(".chat-rail")!, 200, 60);
    expect(host.querySelector(".chat-rail.is-overlay.is-open")).toBeNull();

    // A short movement is a tap or a scroll, never a swipe.
    swipe(thread, 30, 60);
    expect(host.querySelector(".chat-rail.is-overlay.is-open")).toBeNull();
  });
});
