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
  activeAIProvider: (choice: { remote: AIProviderConfig }) => choice.remote,
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
    return { content: options?.tools?.length ? "Tool answer." : "Planned answer." };
  }),
}));

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
  requests = [];
});

function render(entries: Entry[]) {
  act(() => {
    root.render(
      <ChatDialog
        locale="zh"
        entries={entries}
        aiPreferences={{
          enabled: true,
          ask: { backend: "remote", thinking: false, remote: { kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" }, local: { kind: "local-openai-compatible", baseUrl: "http://127.0.0.1:8080/v1", model: "local" } },
          capture: { mode: "offline" },
        }}
        conversations={createMemoryConversationStore()}
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
  it("returns model tool_calls to the model and shows the local retrieval trace", async () => {
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
    expect(first[1].at(-1)?.content).toContain("饮食");

    const second = requests[1];
    expect(second.at(-2)).toMatchObject({ role: "assistant", tool_calls: [expect.objectContaining({ id: "call-diet-sleep" })] });
    const toolMessage = second.at(-1)!;
    expect(toolMessage).toMatchObject({ role: "tool", tool_call_id: "call-diet-sleep", name: "search_entries" });
    expect(toolMessage.content).toContain("饮食记录");
    expect(toolMessage.content).not.toContain("旧记录");

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
    expect(messages.at(-2)).toMatchObject({
      role: "assistant",
      tool_calls: [expect.objectContaining({ id: "dietPattern-0", function: expect.objectContaining({ name: "search_entries" }) })],
    });
    const toolMessage = messages.at(-1)!;
    expect(toolMessage.role).toBe("tool");
    expect(toolMessage.content).toContain("早餐");
    expect(toolMessage.content).not.toContain("旧早餐");
    expect(toolMessage.content).toContain("\"duration_minutes\":20");
    expect(toolMessage.content).toContain("kinds=event=1");
    expect(host.querySelector(".chat-tool-trace")?.textContent).toContain("检索条目");
    expect(host.textContent).toContain("Planned answer.");
  });
});
