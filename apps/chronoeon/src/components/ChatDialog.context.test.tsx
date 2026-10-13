// @vitest-environment jsdom
import { act } from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProviderConfig, AIChatMessage } from "@chronoeon/domain";
import { createDefaultSettings } from "@chronoeon/domain";
import type { Entry } from "../domain/entry";
import { createMemoryConversationStore } from "../ai/memoryConversationStore";
import { requestAICompletion } from "../ai/provider";
import { ChatDialog } from "./ChatDialog";

let host: HTMLDivElement;
let root: Root;
let capturedSystem = "";
const dialogExtras = {
  initialMode: "ask" as const,
  settings: createDefaultSettings(),
  onConfirmCapture: vi.fn(async () => true),
  onOpenManualCapture: () => undefined,
};

vi.mock("../ai/provider", () => ({
  activeAIProvider: (preferences: { providers: AIProviderConfig[] }) => preferences.providers[0],
  askIsReady: () => true,
  requestAICompletion: vi.fn(async (_provider: AIProviderConfig, messages: AIChatMessage[]) => {
    capturedSystem = String(messages[0]?.content ?? "");
    return { content: "Context received." };
  }),
}));

function entry(id: string, title: string, date: string): Entry {
  return {
    id,
    kind: "idea",
    title,
    date,
    allDay: true,
    category: "personal",
    color: "#77787b",
    createdAt: `${date}T00:00:00.000Z`,
  };
}

function isoDaysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function ContextHost({ initialEntries, removeId }: { initialEntries: Entry[]; removeId: string }) {
  const [entries, setEntries] = useState(initialEntries);
  return (
    <>
      <ChatDialog
        locale="en"
        entries={entries}
        aiPreferences={{
          enabled: true,
          ask: { thinking: false, mode: "ai" }, providers: [{ id: "test", name: "Test", preset: "compatible", kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" }], activeProviderId: "test",
          capture: { mode: "offline" },
        }}
        conversations={createMemoryConversationStore()}
        {...dialogExtras}
        onOpenEntry={() => undefined}
        onOpenSettings={() => undefined}
        onClose={() => undefined}
      />
      <button type="button" className="remove-entry" onClick={() => setEntries((current) => current.filter((item) => item.id !== removeId))}>remove</button>
    </>
  );
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("AI chat context selection", () => {
  it("sends only the entries the user explicitly selected", async () => {
    const conversations = createMemoryConversationStore();
    act(() => {
      root.render(
        <ChatDialog
          locale="en"
          entries={[
            entry("selected", "Selected idea", "2026-08-10"),
            entry("excluded", "Excluded task", "2026-08-09"),
          ]}
          aiPreferences={{
            enabled: true,
            ask: { thinking: false, mode: "ai" }, providers: [{ id: "test", name: "Test", preset: "compatible", kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" }], activeProviderId: "test",
            capture: { mode: "offline" },
          }}
          conversations={conversations}
          {...dialogExtras}
          onOpenEntry={() => undefined}
          onOpenSettings={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    act(() => { host.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
    act(() => { host.querySelector<HTMLInputElement>(".chat-context-item input")!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setValue) throw new Error("textarea value setter is unavailable");
    act(() => {
      setValue.call(textarea, "What should I prepare?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    expect(host.querySelector(".chat-tool b")?.textContent).toBe("1");
    expect(capturedSystem).toContain("Selected idea");
    expect(capturedSystem).not.toContain("Excluded task");
    expect(host.textContent).toContain("Context received.");
  });

  it("scopes automatic context to the selected recent-week range", async () => {
    const conversations = createMemoryConversationStore();
    act(() => {
      root.render(
        <ChatDialog
          locale="en"
          entries={[
            entry("recent", "Recent idea", isoDaysFromToday(-1)),
            entry("older", "Older idea", isoDaysFromToday(-40)),
          ]}
          aiPreferences={{
            enabled: true,
            ask: { thinking: false, mode: "ai" }, providers: [{ id: "test", name: "Test", preset: "compatible", kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" }], activeProviderId: "test",
            capture: { mode: "offline" },
          }}
          conversations={conversations}
          {...dialogExtras}
          onOpenEntry={() => undefined}
          onOpenSettings={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    act(() => { host.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
    const lastWeek = [...host.querySelectorAll<HTMLButtonElement>(".chat-context-range-options button")]
      .find((button) => button.textContent === "Last 7 days")!;
    act(() => { lastWeek.click(); });
    expect(host.textContent).toContain("Recent idea");
    expect(host.textContent).not.toContain("Older idea");

    act(() => { host.querySelector<HTMLInputElement>(".chat-context-item input")!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setValue) throw new Error("textarea value setter is unavailable");
    act(() => {
      setValue.call(textarea, "Summarize the current week.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    expect(capturedSystem).toContain("Recent idea");
    expect(capturedSystem).not.toContain("Older idea");
  });

  it.each(["mouse", "touch"])("supports custom context dates with %s pointer events and nested dismissal", async (pointerType) => {
    vi.useFakeTimers({ now: new Date("2026-08-31T12:00:00"), shouldAdvanceTime: true });
    const conversations = createMemoryConversationStore();
    try {
      act(() => {
        root.render(
          <ChatDialog
            locale="en"
            entries={[
              entry("late", "Late August idea", "2026-08-30"),
              entry("early", "Early August idea", "2026-08-20"),
            ]}
            aiPreferences={{
              enabled: true,
              ask: { thinking: false, mode: "ai" }, providers: [{ id: "test", name: "Test", preset: "compatible", kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" }], activeProviderId: "test",
              capture: { mode: "offline" },
            }}
            conversations={conversations}
            {...dialogExtras}
            onOpenEntry={() => undefined}
            onOpenSettings={() => undefined}
            onClose={() => undefined}
          />,
        );
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(30); });

      act(() => { host.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
      const custom = [...host.querySelectorAll<HTMLButtonElement>(".chat-context-range-options button")]
        .find((button) => button.textContent === "Custom")!;
      act(() => { custom.click(); });
      expect(host.textContent).toContain("Early August idea");

      // HTMLElement.click() skips pointerdown and cannot catch portal dismissal bugs.
      const click = (element: HTMLElement) => {
        act(() => { element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType })); });
        expect(element.isConnected).toBe(true);
        act(() => { element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType })); element.click(); });
      };
      click(host.querySelector<HTMLButtonElement>(".chat-context-dates .glass-picker-trigger")!);
      click(document.querySelector<HTMLButtonElement>('.glass-picker-popup button[aria-label="Previous month"]')!);
      expect(document.querySelector(".glass-picker-month strong")?.textContent).toBe("July 2026");
      click(document.querySelector<HTMLButtonElement>('.glass-picker-popup button[aria-label="Next month"]')!);
      expect(host.querySelector(".chat-context-panel")).not.toBeNull();
      const startCell = [...document.querySelectorAll<HTMLButtonElement>(".glass-date-cell")]
        .find((cell) => cell.textContent === "25" && !cell.disabled)!;
      click(startCell);
      expect(host.textContent).not.toContain("Early August idea");
      expect(host.textContent).toContain("Late August idea");
      const rangeSelectAll = [...host.querySelectorAll<HTMLButtonElement>(".chat-context-panel button")]
        .find(button => button.textContent === "Select all matches")!;
      click(rangeSelectAll);
      expect(host.querySelector(".chat-tool b")?.textContent).toBe("1");
      expect(rangeSelectAll.disabled).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(document.querySelector(".glass-picker-popup")).toBeNull();
      const endTrigger = host.querySelectorAll<HTMLButtonElement>(".chat-context-dates .glass-picker-trigger")[1];
      click(endTrigger);
      const endCell = [...document.querySelectorAll<HTMLButtonElement>(".glass-date-cell:not(.is-outside)")].find(cell => cell.textContent === "29")!;
      click(endCell);
      expect(host.querySelector(".chat-context-panel")).not.toBeNull();
      expect(host.textContent).not.toContain("Late August idea");
      expect(endTrigger.textContent).toContain("2026-08-29");
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      click(endTrigger);
      act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(document.querySelector(".glass-picker-popup")).toBeNull();
      expect(host.querySelector(".chat-context-panel")).not.toBeNull();
      click(endTrigger);
      click(host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!);
      expect(host.querySelector(".chat-context-panel")).toBeNull();
      expect(document.querySelector(".glass-picker-popup")).toBeNull();
      expect(host.querySelector(".chat-dialog")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("carried-context thumbnail lists selections; composer shows model and tokens", async () => {
    const conversations = createMemoryConversationStore();
    vi.mocked(requestAICompletion).mockImplementationOnce(async () => ({
      content: "Reply with **bold** and `code`.",
      promptTokens: 120,
      completionTokens: 45,
    }));
    act(() => {
      root.render(
        <ChatDialog
          locale="en"
          entries={[entry("sel", "Carried idea", "2026-08-10"), entry("other", "Other idea", "2026-08-11")]}
          aiPreferences={{
            enabled: true,
            ask: { thinking: false, mode: "ai" }, providers: [{ id: "test", name: "Test", preset: "compatible", kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" }], activeProviderId: "test",
            capture: { mode: "offline" },
          }}
          conversations={conversations}
          {...dialogExtras}
          onOpenEntry={() => undefined}
          onOpenSettings={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    // The composer status line names the answering model from the start.
    expect(host.querySelector(".chat-composer-meta .chat-composer-model")?.textContent).toContain("remote");
    expect(host.querySelector(".chat-composer-tokens")).toBeNull();

    // Selecting an entry grows a thumbnail button; the popup lists it.
    act(() => { host.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
    act(() => { host.querySelector<HTMLInputElement>(".chat-context-item input")!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
    const thumb = host.querySelector<HTMLButtonElement>(".chat-carried-toggle")!;
    expect(thumb.querySelectorAll("i")).toHaveLength(1);
    act(() => { thumb.click(); });
    // Candidates sort most-recent first, so the first row is "Other idea".
    const panel = host.querySelector(".chat-carried-panel")!;
    expect(panel.textContent).toContain("Other idea");
    // Removing the entry from the popup clears the thumbnail.
    act(() => { panel.querySelector<HTMLButtonElement>("li button")!.click(); });
    expect(host.querySelector(".chat-carried-toggle")).toBeNull();

    // A reply reports its token spend on the composer status line.
    act(() => { host.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
    act(() => { host.querySelector<HTMLInputElement>(".chat-context-item input")!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setValue) throw new Error("textarea value setter is unavailable");
    act(() => {
      setValue.call(textarea, "Summarize");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    const tokens = host.querySelector(".chat-composer-tokens")?.textContent ?? "";
    expect(tokens).toContain("120");
    expect(tokens).toContain("45");
  });

  it("drops carried-context ids whose entries no longer exist", async () => {
    const localHost = document.createElement("div");
    document.body.appendChild(localHost);
    const localRoot = createRoot(localHost);
    act(() => { localRoot.render(<ContextHost initialEntries={[entry("gone", "Temporary idea", "2026-08-10")]} removeId="gone" />); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    act(() => { localHost.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
    act(() => { localHost.querySelector<HTMLInputElement>(".chat-context-item input")!.click(); });
    act(() => { localHost.querySelector<HTMLButtonElement>(".chat-tool")!.click(); });
    expect(localHost.querySelector(".chat-tool b")?.textContent).toBe("1");

    act(() => { localHost.querySelector<HTMLButtonElement>(".remove-entry")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(localHost.querySelector(".chat-tool b")).toBeNull();
    act(() => { localRoot.unmount(); });
    localHost.remove();
  });
});

 it.each(["en", "zh"] as const)("selects all filtered matches beyond the visible list and preserves prior context (%s)", async (locale) => {
  const matches = Array.from({ length: 123 }, (_, i) => entry(
    "match-" + i, "Match idea " + i, isoDaysFromToday(-1),
  ));
  const excluded = [
    entry("old", "Match old idea", isoDaysFromToday(-40)),
    { ...entry("task", "Match task", isoDaysFromToday(-1)), kind: "task" as const },
    entry("query", "Unrelated idea", isoDaysFromToday(-1)),
  ];
  await act(async () => root.render(<ChatDialog
    locale={locale} entries={[entry("pinned", "Pinned record", isoDaysFromToday(1)), ...matches, ...excluded]}
    aiPreferences={{ enabled: true, ask: { thinking: false, mode: "ai" }, providers: [{ id: "test", name: "Test", preset: "compatible", kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" }], activeProviderId: "test", capture: { mode: "offline" } }}
    conversations={createMemoryConversationStore()} {...dialogExtras}
    onOpenEntry={() => {}} onOpenSettings={() => {}} onClose={() => {}} />));
  act(() => host.querySelector<HTMLButtonElement>(".chat-tool")!.click());
  act(() => host.querySelector<HTMLInputElement>('.chat-context-item input[aria-label="Pinned record"]')!.click());
  act(() => host.querySelectorAll<HTMLButtonElement>(".chat-context-range-options button")[1].click());
  for (const checkbox of [...host.querySelectorAll<HTMLButtonElement>('.chat-context-kinds [role="checkbox"]')].slice(0, 3)) {
    act(() => checkbox.click());
  }
  const search = host.querySelector<HTMLInputElement>(".chat-context-panel input:not([type=checkbox])")!;
  const query = (text: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, text);
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  query("Match");
  const selectAll = [...host.querySelectorAll<HTMLButtonElement>(".chat-context-panel button")].find(button => button.textContent === (locale === "zh" ? "全选当前范围" : "Select all matches"))!;
  expect(selectAll).toBeDefined();
  expect(selectAll.disabled).toBe(false);
  act(() => host.querySelector<HTMLInputElement>(".chat-context-item input")!.click());
  expect(selectAll.disabled).toBe(false);
  act(() => selectAll.click());
  expect(selectAll.disabled).toBe(true);
  expect(host.querySelector(".chat-tool b")?.textContent).toBe("124");
  expect(host.querySelectorAll(".chat-context-item input:checked")).toHaveLength(120);
  expect(host.querySelector(".chat-context-selection")?.textContent).toContain("123");
  query("no matching records");
  expect(selectAll.disabled).toBe(true);
  expect(host.querySelectorAll(".chat-context-item")).toHaveLength(0);
  expect(host.querySelector(".chat-tool b")?.textContent).toBe("124");
  act(() => host.querySelector<HTMLButtonElement>(".chat-tool")!.click());
  const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Summarize these records");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>(".chat-send")!.click());
  expect(capturedSystem).toContain("Answer in English");
  expect(capturedSystem).toContain("Pinned record");
  for (const item of matches) expect(capturedSystem).toContain(item.title);
  for (const item of excluded) expect(capturedSystem).not.toContain(item.title);
 });
