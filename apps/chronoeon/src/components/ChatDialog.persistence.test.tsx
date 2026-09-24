// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@chronoeon/domain";
import { AiConversationStore, SqliteEntryStore, type PersistencePort, type SqlParam } from "@chronoeon/storage";
import { MemorySqliteBackend } from "@chronoeon/storage/test";
import { ChatDialog } from "./ChatDialog";

vi.mock("../ai/provider", () => ({
  activeAIProvider: () => ({ kind: "openai-compatible" }),
  askIsReady: () => false,
  requestAICompletion: vi.fn(),
}));

/** SQLite over IPC costs at least one task per statement; the real dialogue
 *  path is the same store with that latency, so the test keeps it. */
function withStatementLatency(backend: PersistencePort): PersistencePort {
  const tick = () => new Promise<void>((resolve) => { window.setTimeout(resolve, 0); });
  return {
    async execute(sql: string, params?: SqlParam[]) { await tick(); return backend.execute(sql, params); },
    async select<T = Record<string, never>>(sql: string, params?: SqlParam[]) { await tick(); return backend.select<T>(sql, params); },
    async transaction<T>(work: () => Promise<T>) { await tick(); return backend.transaction(work); },
    close: () => backend.close(),
  };
}

async function openConversations(): Promise<AiConversationStore> {
  const backend = await MemorySqliteBackend.open([]);
  await SqliteEntryStore.create(backend);
  return new AiConversationStore(withStatementLatency(backend));
}

let host: HTMLDivElement;
let root: Root;

function render(store: AiConversationStore, onClose = vi.fn()) {
  act(() => {
    root.render(
      <ChatDialog
        locale="zh"
        entries={[]}
        aiPreferences={{
          enabled: true,
          ask: { backend: "remote", thinking: false, remote: { kind: "openai-compatible", baseUrl: "https://example.test/v1", model: "remote" }, local: { kind: "local-openai-compatible", baseUrl: "http://127.0.0.1:8080/v1", model: "local" } },
          capture: { mode: "offline" },
        }}
        conversations={store}
        settings={createDefaultSettings()}
        initialMode="capture"
        onOpenEntry={() => undefined}
        onConfirmCapture={vi.fn(async () => true)}
        onOpenManualCapture={() => undefined}
        onOpenSettings={() => undefined}
        onClose={onClose}
      />,
    );
  });
}

async function sendText(text: string) {
  const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setValue.call(textarea, text); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => {
    host.querySelector<HTMLButtonElement>(".chat-send")!.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  // The send is done when the reply landed; the parses are asynchronous.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (host.querySelector(".chat-message--user") && !host.querySelector(".chat-message--assistant.is-busy")) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

/** Wait until the thread reflects the database read that follows the reopen. */
async function waitForUserBubble() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (host.querySelector(".chat-message--user")) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
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

describe("capture conversation persistence", () => {
  it("shows the sent message once even when the history read lands mid-send", async () => {
    const store = await openConversations();
    render(store);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    await sendText("明天 14:00 开会");

    const userBubbles = [...host.querySelectorAll(".chat-message--user .chat-rich")]
      .map((node) => node.textContent ?? "");
    expect(userBubbles).toEqual(["明天 14:00 开会"]);
    const stored = await store.listMessages((await store.listConversations())[0].id);
    expect(stored.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("resumes the conversation and its messages after the dialog is reopened", async () => {
    const store = await openConversations();
    render(store);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    await sendText("买菜 36 现金");

    act(() => root.unmount());
    root = createRoot(host);
    render(store);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    await waitForUserBubble();

    // The reopened dialog shows what the database holds, without a second click.
    const userBubbles = [...host.querySelectorAll(".chat-message--user .chat-rich")]
      .map((node) => node.textContent ?? "");
    expect(userBubbles).toEqual(["买菜 36 现金"]);
  });

  it("keeps the parsed capture review across a close and reopen", async () => {
    const store = await openConversations();
    render(store);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    await sendText("明天 14:00 开会");
    expect(host.querySelector(".capture-review-card")).toBeTruthy();

    // An edit belongs to the same card and must survive as well.
    const title = host.querySelector<HTMLInputElement>(".capture-review-title-input")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(title, "改成评审会");
      title.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    act(() => root.unmount());
    expect((await store.loadCaptureReview((await store.listConversations())[0].id))?.drafts).toHaveLength(1);
    root = createRoot(host);
    render(store);
    for (let attempt = 0; attempt < 40 && !host.querySelector(".capture-review-card"); attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    }

    // The confirmation card is back, still waiting for the user.
    const restored = host.querySelector<HTMLInputElement>(".capture-review-title-input");
    expect(restored?.value).toBe("改成评审会");
    expect(host.querySelector(".chat-capture-review")?.textContent).toContain("确认后保存");
  });
});
