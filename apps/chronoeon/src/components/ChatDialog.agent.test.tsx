// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProviderConfig, AIChatMessage } from "@chronoeon/domain";
import { createDefaultSettings } from "@chronoeon/domain";
import type { Entry } from "../domain/entry";
import { createMemoryConversationStore } from "../ai/memoryConversationStore";
import { requestAICompletion } from "../ai/provider";
import { askPresets } from "../ai/askPresets";
import { ChatDialog } from "./ChatDialog";

let host: HTMLDivElement;
let root: Root;
let requests: AIChatMessage[][] = [];

vi.mock("../ai/provider", () => ({
  activeAIProvider: (preferences: { providers: AIProviderConfig[] }) => preferences.providers[0],
  askIsReady: () => true,
  requestAICompletion: vi.fn(async (
    _provider: AIProviderConfig,
    messages: AIChatMessage[],
    _schema: unknown,
    _signal: unknown,
    options?: { tools?: unknown[]; disableReasoning?: boolean },
  ) => {
    requests.push(messages);
    if (options?.tools?.length && requests.length === 1) {
      return {
        content: "",
        toolCalls: [{
          id: "call-diet-sleep",
          type: "function" as const,
          function: {
            name: "search_entries",
            arguments: JSON.stringify({ query: "饮食 睡眠", start_date: "2026-09-13", end_date: "2026-09-19" }),
          },
        }],
      };
    }
    return { content: requests.length > 1 ? "Tool answer." : "Planned answer." };
  }),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 19, 12));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
  requests = [];
});

function render(entries: Entry[], conversations = createMemoryConversationStore()) {
  act(() => {
    root.render(
      <ChatDialog
        locale="zh"
        entries={entries}
        aiPreferences={{
          enabled: true,
          ask: { thinking: false, mode: "ai" }, providers: [{ id: "test", name: "Test", preset: "compatible", kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" }], activeProviderId: "test",
          capture: { mode: "offline" },
        }}
        conversations={conversations}
        settings={createDefaultSettings()}
        initialMode="ask"
        onOpenEntry={() => undefined}
        onConfirmCapture={vi.fn(async () => true)}
        onOpenManualCapture={() => undefined}
        onOpenSettings={() => undefined}
        onClose={() => undefined}
      />,
    );
  });
}

describe("AI advisor model tool workflow", () => {
  it("synthesizes a final answer from tool data without replaying tool protocol", async () => {
    render([
      { id: "food", kind: "event", title: "饮食记录", date: "2026-09-18", allDay: true, category: "personal", color: "#77787b", createdAt: "2026-09-18T12:00:00.000Z" },
      { id: "old", kind: "idea", title: "旧记录", date: "2026-08-01", allDay: true, category: "personal", color: "#77787b", createdAt: "2026-08-01T12:00:00.000Z" },
    ]);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, "帮我分析近几天的饮食/睡眠状况"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    expect(requests).toHaveLength(2);
    const first = vi.mocked(requestAICompletion).mock.calls[0];
    expect(first[4]?.tools?.map((tool) => tool.function.name)).toContain("search_entries");
    expect(first[4]).toMatchObject({ maxTokens: 1024, disableReasoning: true });
    expect(first[1].at(-1)?.content).toContain("饮食");

    const second = requests[1];
    expect(second.some(message => message.role === "tool" || message.tool_calls)).toBe(false);
    expect(second[0].content).toContain("饮食记录");
    expect(second[0].content).not.toContain("旧记录");
    expect(second[0].content).toContain("Retrieval is complete");

    const trace = host.querySelector(".chat-tool-trace")!;
    expect(trace.textContent).toContain("检索条目");
    expect(trace.textContent).toContain("饮食");
    expect(trace.textContent).toContain("1 条记录");
    expect(host.textContent).toContain("Tool answer.");
  });

  it("executes a preset's deterministic plan and asks for a grounded summary", async () => {
    render([
      { id: "breakfast", kind: "event", title: "早餐", date: "2026-09-18", start: "07:40", end: "08:00", category: "饮食", color: "#77787b", createdAt: "2026-09-18T12:00:00.000Z" },
      { id: "old", kind: "event", title: "旧早餐", date: "2025-09-18", start: "07:40", end: "08:00", category: "饮食", color: "#77787b", createdAt: "2025-09-18T12:00:00.000Z" },
    ]);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    const preset = askPresets("zh").find((item) => item.id === "dietPattern")!;
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, preset.prompt); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    expect(requests).toHaveLength(1);
    const call = vi.mocked(requestAICompletion).mock.calls[0];
    expect(call[4]?.tools).toBeUndefined();
    expect(call[4]?.disableReasoning).toBe(true);
    const messages = call[1];
    expect(messages.some(message => message.role === "tool" || message.tool_calls)).toBe(false);
    expect(messages[0].content).toContain("早餐");
    expect(messages[0].content).not.toContain("旧早餐");
    expect(messages[0].content).toContain("\"duration_minutes\":20");
    expect(messages[0].content).toContain("kinds=event=1");
    expect(host.querySelector(".chat-tool-trace")?.textContent).toContain("检索条目");
    expect(host.textContent).toContain("Planned answer.");
  });
});

it("keeps complete stored history while bounding native model requests", async () => {
  const store = createMemoryConversationStore();
  render([], store);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  for (let i = 0; i < 18; i++) {
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, `Diet analysis ${i}`);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".chat-send")!.click();
      await new Promise(resolve => setTimeout(resolve, 30));
    });
  }
  expect(requests.at(-1)!.length).toBeLessThanOrEqual(25);
  expect(requests.at(-1)!.at(-1)!.content).toBe("Diet analysis 17");
  const conversation = (await store.listConversations())[0];
  expect(await store.listMessages(conversation.id)).toHaveLength(36);
});
