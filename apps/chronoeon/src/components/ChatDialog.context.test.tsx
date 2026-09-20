// @vitest-environment jsdom
import { act } from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProviderConfig, AIChatMessage } from "@chronoeon/domain";
import type { Entry } from "../domain/entry";
import { createMemoryConversationStore } from "../ai/memoryConversationStore";
import { requestAICompletion } from "../ai/provider";
import { ChatDialog } from "./ChatDialog";

let host: HTMLDivElement;
let root: Root;
let capturedSystem = "";

vi.mock("../ai/provider", () => ({
  activeAIProvider: (preferences: { local: AIProviderConfig }) => preferences.local,
  providerIsConfigured: () => true,
  requestAICompletion: vi.fn(async (_provider: AIProviderConfig, messages: AIChatMessage[]) => {
    capturedSystem = messages[0]?.content ?? "";
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
          backend: "local",
          remote: { kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" },
          local: { kind: "local-openai-compatible", baseUrl: "http://166.111.240.129:8080/v1", model: "Qwen3.8-27B" },
        }}
        conversations={createMemoryConversationStore()}
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
            backend: "local",
            remote: { kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" },
            local: { kind: "local-openai-compatible", baseUrl: "http://166.111.240.129:8080/v1", model: "Qwen3.8-27B" },
          }}
          conversations={conversations}
          onOpenEntry={() => undefined}
          onOpenSettings={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    act(() => { host.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
    act(() => { host.querySelector<HTMLInputElement>(".chat-context-item input")!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setValue) throw new Error("textarea value setter is unavailable");
    act(() => {
      setValue.call(textarea, "What should I prepare?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    expect(host.querySelector(".chat-context-toggle b")?.textContent).toBe("1");
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
            backend: "local",
            remote: { kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" },
            local: { kind: "local-openai-compatible", baseUrl: "http://166.111.240.129:8080/v1", model: "Qwen3.8-27B" },
          }}
          conversations={conversations}
          onOpenEntry={() => undefined}
          onOpenSettings={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    act(() => { host.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
    const lastWeek = [...host.querySelectorAll<HTMLButtonElement>(".chat-context-range-options button")]
      .find((button) => button.textContent === "Last 7 days")!;
    act(() => { lastWeek.click(); });
    expect(host.textContent).toContain("Recent idea");
    expect(host.textContent).not.toContain("Older idea");

    act(() => { host.querySelector<HTMLInputElement>(".chat-context-item input")!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
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

  it("supports a custom date range in the context picker", async () => {
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
              backend: "local",
              remote: { kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" },
              local: { kind: "local-openai-compatible", baseUrl: "http://166.111.240.129:8080/v1", model: "Qwen3.8-27B" },
            }}
            conversations={conversations}
            onOpenEntry={() => undefined}
            onOpenSettings={() => undefined}
            onClose={() => undefined}
          />,
        );
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(30); });

      act(() => { host.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
      const custom = [...host.querySelectorAll<HTMLButtonElement>(".chat-context-range-options button")]
        .find((button) => button.textContent === "Custom")!;
      act(() => { custom.click(); });
      expect(host.textContent).toContain("Early August idea");

      act(() => { host.querySelector<HTMLButtonElement>(".chat-context-dates .glass-picker-trigger")!.click(); });
      const startCell = [...document.querySelectorAll<HTMLButtonElement>(".glass-date-cell")]
        .find((cell) => cell.textContent === "25" && !cell.disabled)!;
      act(() => { startCell.click(); });
      expect(host.textContent).not.toContain("Early August idea");
      expect(host.textContent).toContain("Late August idea");
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
            backend: "local",
            remote: { kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" },
            local: { kind: "local-openai-compatible", baseUrl: "http://166.111.240.129:8080/v1", model: "Qwen3.8-27B" },
          }}
          conversations={conversations}
          onOpenEntry={() => undefined}
          onOpenSettings={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    // The composer status line names the answering model from the start.
    expect(host.querySelector(".chat-composer-meta .chat-composer-model")?.textContent).toContain("Qwen3.8-27B");
    expect(host.querySelector(".chat-composer-tokens")).toBeNull();

    // Selecting an entry grows a thumbnail button; the popup lists it.
    act(() => { host.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
    act(() => { host.querySelector<HTMLInputElement>(".chat-context-item input")!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
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
    act(() => { host.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
    act(() => { host.querySelector<HTMLInputElement>(".chat-context-item input")!.click(); });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
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
    act(() => { localHost.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
    act(() => { localHost.querySelector<HTMLInputElement>(".chat-context-item input")!.click(); });
    act(() => { localHost.querySelector<HTMLButtonElement>(".chat-context-toggle")!.click(); });
    expect(localHost.querySelector(".chat-context-toggle b")?.textContent).toBe("1");

    act(() => { localHost.querySelector<HTMLButtonElement>(".remove-entry")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(localHost.querySelector(".chat-context-toggle b")).toBeNull();
    act(() => { localRoot.unmount(); });
    localHost.remove();
  });
});
