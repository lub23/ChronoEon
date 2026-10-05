// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@chronoeon/domain";
import { createMemoryConversationStore } from "../ai/memoryConversationStore";
import { ChatDialog } from "./ChatDialog";

const { configured } = vi.hoisted(() => ({ configured: { value: false } }));
vi.mock("../ai/provider", () => ({
  activeAIProvider: () => ({ kind: "openai-compatible" }),
  askIsReady: () => configured.value,
  requestAICompletion: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  configured.value = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

function render(onConfirm = vi.fn(async () => true), onManualAdd = vi.fn(), props: Partial<ComponentProps<typeof ChatDialog>> = {}) {
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
        conversations={createMemoryConversationStore()}
        settings={createDefaultSettings()}
        initialMode="capture"
        onOpenEntry={() => undefined}
        onConfirmCapture={onConfirm}
        onOpenManualCapture={onManualAdd}
        onOpenSettings={() => undefined}
        onClose={() => undefined}
        {...props}
      />,
    );
  });
}

function renderWith(store: ReturnType<typeof createMemoryConversationStore>, initialMode: "capture" | "ask" = "capture") {
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
        initialMode={initialMode}
        onOpenEntry={() => undefined}
        onConfirmCapture={vi.fn(async () => true)}
        onOpenManualCapture={() => undefined}
        onOpenSettings={() => undefined}
        onClose={() => undefined}
      />,
    );
  });
}

describe("unified capture and ask dialog", () => {
  async function enterCapture(text: string) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
    return textarea;
  }

  it("hands a parsed asset to the item composer without creating an entry", async () => {
    const onConfirm = vi.fn(async () => true);
    const onOpenAssetCapture = vi.fn();
    render(onConfirm, vi.fn(), { onOpenAssetCapture });
    await enterCapture("/asset tomorrow 15:00 Laptop $900 @Home");
    expect(onOpenAssetCapture).toHaveBeenCalledWith(expect.objectContaining({ name: "Laptop", cost: 900, currency: "USD", acquiredAt: "15:00", location: "Home" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(host.querySelector(".chat-capture-review")).toBeNull();
  });

  it("requires a concrete eligible asset before handing off a bill link", async () => {
    const settings = createDefaultSettings();
    const onConfirm = vi.fn(async () => true);
    const onOpenLinkedCapture = vi.fn();
    const asset = { id: "laptop-id", name: "Laptop", calendarId: settings.defaultCalendarID, category: "default", acquisition: "purchase" as const, acquiredOn: "2026-10-04", acquiredAt: "00:00", cost: 0, currency: "USD", createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z" };
    render(onConfirm, vi.fn(), { settings, availableAssets: [asset, { ...asset, id: "linked", purchaseEntryId: "existing" }], onOpenLinkedCapture });
    await enterCapture("/bill Laptop $900 &Laptop");
    expect(host.querySelector<HTMLButtonElement>(".capture-review-confirm")!.disabled).toBe(true);
    const links = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="关联物品"] button')].filter(button => button.textContent === "Laptop");
    expect(links).toHaveLength(1);
    act(() => links[0].click());
    expect(onOpenLinkedCapture).toHaveBeenCalledWith(expect.objectContaining({ kind: "bill", amount: -900 }), "laptop-id");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("requires confirmation for conflicting explicit fields", async () => {
    const onConfirm = vi.fn(async () => true);
    render(onConfirm);
    await enterCapture("/task Review @Home @Office");
    expect(host.querySelector<HTMLButtonElement>(".capture-review-confirm")!.disabled).toBe(true);
    expect(host.textContent).toContain("请确认");
    const accept = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "使用当前字段")!;
    act(() => accept.click());
    expect(host.querySelector<HTMLButtonElement>(".capture-review-confirm")!.disabled).toBe(false);
    await act(async () => { host.querySelector<HTMLButtonElement>(".capture-review-confirm")!.click(); });
    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ location: "Home" })]);
  });

  it("restores source text when local parsing persistence fails", async () => {
    const store = createMemoryConversationStore();
    vi.spyOn(store, "appendMessage").mockRejectedValue(new Error("disk full"));
    render(vi.fn(async () => true), vi.fn(), { conversations: store });
    const textarea = await enterCapture("/task important original text");
    expect(textarea.value).toBe("/task important original text");
  });

  it("offers matching syntax completions", async () => {
    render(vi.fn(async () => true), vi.fn(), { availableTags: ["project-a", "garden"] });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "/task Review #pro"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => textarea.dispatchEvent(new Event("focus", { bubbles: false })));
    const completion = host.querySelector<HTMLButtonElement>(".field-suggestion-menu button")!;
    expect(completion.textContent).toBe("project-a");
    act(() => completion.click());
    expect(textarea.value).toBe("/task Review #project-a ");
  });

  it("parses capture text offline and requires manual confirmation after an edit", async () => {
    const onConfirm = vi.fn(async () => true);
    const onManualAdd = vi.fn();
    render(onConfirm, onManualAdd);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, "明天 14:00 开会"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });

    expect(host.querySelector("#chat-title")?.textContent).toBe("随心记");
    expect(host.querySelector(".chat-capture-review")).toBeTruthy();
    expect(host.textContent).toContain("随心问");
    expect(onConfirm).not.toHaveBeenCalled();

    // Manual add lives beside the parse button, not in the history rail.
    expect(host.querySelector(".chat-rail-actions .chat-rail-action")?.textContent).toContain("新对话");
    const manualAdd = host.querySelector<HTMLButtonElement>(".chat-composer .chat-manual-add")!;
    expect(manualAdd.getAttribute("aria-label")).toBe("手动添加");
    await act(async () => { manualAdd.click(); });
    expect(onManualAdd).toHaveBeenCalledWith("明天 14:00 开会");
  });

  it("parses punctuation-separated notes as one review card per item", async () => {
    render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, "明天 10:00 开会。午餐 -36 现金；记得周五交报告"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });

    expect(host.querySelectorAll(".capture-review-card")).toHaveLength(3);
    expect(host.textContent).toContain("已解析，请核对");
    expect(document.querySelector(".chat-kind-chip.is-event")).toBeTruthy();
    expect(document.querySelector(".chat-kind-chip.is-bill")).toBeTruthy();
  });

  it("switches between Capture and Ask without opening a second dialog", async () => {
    render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    const tabs = [...host.querySelectorAll<HTMLButtonElement>(".chat-mode-tabs button")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["随心记", "随心问"]);
    // The header switch is the dialog title: the selected mode is the big one.
    expect(host.querySelector(".chat-mode-tabs button.is-active")?.textContent).toBe("随心记");
    expect(host.querySelector(".chat-mode-tabs .is-active svg")?.getAttribute("width")).toBe("16");
    const captureOrb = host.querySelector(".chat-welcome-orb svg path")?.getAttribute("d");
    await act(async () => { tabs[1].click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(host.querySelector("#chat-title")?.textContent).toBe("随心问");
    expect(host.querySelector(".quick-note")).toBeNull();
    // The centre icon follows the mode instead of always showing the old one.
    expect(host.querySelector(".chat-welcome-orb svg path")?.getAttribute("d")).not.toBe(captureOrb);

    // Tab is the composer switch, from the composer itself too.
    await act(async () => {
      host.querySelector(".chat-dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(host.querySelector("#chat-title")?.textContent).toBe("随心记");
  });

  it("creates a history record only when a conversation actually starts", async () => {
    const store = createMemoryConversationStore();
    renderWith(store);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const tabs = [...host.querySelectorAll<HTMLButtonElement>(".chat-mode-tabs button")];

    // Looking at the other tab (and back) must not file an empty conversation.
    await act(async () => { tabs[1].click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await act(async () => { tabs[0].click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(await store.listConversations()).toHaveLength(0);
    expect(host.querySelectorAll(".chat-conversation")).toHaveLength(0);

    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, "明天 14:00 开会"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });

    const created = await store.listConversations();
    expect(created).toHaveLength(1);
    expect(created[0].mode).toBe("capture");
    expect(host.querySelectorAll(".chat-conversation")).toHaveLength(1);
    expect(host.querySelector(".chat-mode-badge")?.getAttribute("title")).toBe("随心记");
  });

  it("opens a history record in that record's own mode", async () => {
    const store = createMemoryConversationStore();
    const capture = await store.createConversation({ providerKind: "openai-compatible", mode: "capture", title: "随心记 明天开会" });
    await store.appendMessage(capture.id, { role: "user", content: "明天 14:00 开会" });
    const ask = await store.createConversation({ providerKind: "openai-compatible", mode: "ask", title: "随心问 本周总结" });
    await store.appendMessage(ask.id, { role: "user", content: "总结本周" });
    renderWith(store);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    const entryFor = (badge: string) => [...host.querySelectorAll<HTMLButtonElement>(".chat-conversation-open")]
      .find((entry) => entry.querySelector(".chat-mode-badge")?.getAttribute("title") === badge)!;
    expect(entryFor("随心记")).toBeTruthy();
    expect(entryFor("随心问")).toBeTruthy();

    await act(async () => { entryFor("随心记").click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(host.querySelector("#chat-title")?.textContent).toBe("随心记");
    expect(host.textContent).toContain("明天 14:00 开会");

    await act(async () => { entryFor("随心问").click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(host.querySelector("#chat-title")?.textContent).toBe("随心问");
    expect(host.textContent).toContain("总结本周");
  });

  it("keeps capture review fields editable in the summary row", async () => {
    render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, "明天 14:00 开会"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });

    const card = host.querySelector(".capture-review-card")!;
    expect(card.querySelector(".capture-review-title-input")).toBeTruthy();
    // Kind and category are dropdowns; start/end times are wheel buttons.
    expect(card.querySelectorAll(".glass-select-trigger").length).toBeGreaterThanOrEqual(2);
    expect(card.querySelectorAll(".glass-time-trigger").length).toBeGreaterThanOrEqual(1);
    expect(card.querySelector(".capture-review-allday")?.getAttribute("aria-label")).toBe("全天");
    expect(card.querySelector(".capture-review-more")?.textContent).toBe("更多");
  });

  it("drops a single parsed item from its own corner button", async () => {
    render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, "明天 14:00 开会"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });

    const card = host.querySelector(".capture-review-card")!;
    // The end clock is filled in, so the card never shows `--:--`.
    expect(card.querySelector(".capture-review-cluster.is-end .glass-time-trigger")?.textContent).toBe("15:00");
    // The remove button mirrors the item number in the opposite corner.
    expect(card.querySelector(".capture-review-remove")).toBeTruthy();
    await act(async () => { host.querySelector<HTMLButtonElement>(".capture-review-remove")!.click(); });
    expect(host.querySelector(".chat-capture-review")).toBeNull();
  });

  it("keeps a review with its conversation until it is dismissed", async () => {
    const store = createMemoryConversationStore();
    renderWith(store);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, "明天 14:00 开会"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(host.querySelector(".chat-capture-review")).toBeTruthy();

    // A new conversation must not inherit the previous parse.
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-rail-actions .chat-rail-action")!.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(host.querySelector(".chat-capture-review")).toBeNull();

    // Opening the record that produced it brings the review back.
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-conversation-open")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(host.querySelector(".chat-capture-review")).toBeTruthy();

    await act(async () => { host.querySelector<HTMLButtonElement>(".capture-review-dismiss")!.click(); });
    expect(host.querySelector(".chat-capture-review")).toBeNull();
  });

  it("queues an analysis lens into the message instead of sending it", async () => {
    configured.value = true;
    const store = createMemoryConversationStore();
    renderWith(store, "ask");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    const lens = host.querySelector<HTMLButtonElement>(".chat-preset-card")!;
    expect(lens.textContent).toContain("每周回顾");
    await act(async () => { lens.click(); });
    expect(await store.listConversations()).toHaveLength(0);
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    expect(textarea.value).toContain("GTD");
  });

  it("offers an hour and minute wheel for bills too", async () => {
    render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, "午餐 -36 现金"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    const card = host.querySelector(".capture-review-card")!;
    expect(card.querySelector(".capture-review-kind")?.textContent).toContain("账目");
    expect(card.querySelectorAll(".glass-time-trigger").length).toBe(1);
    expect(card.querySelector(".capture-review-allday")).toBeNull();
  });

  it("closes the local-context panel by button or by clicking away", async () => {
    configured.value = true;
    renderWith(createMemoryConversationStore(), "ask");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const contextTool = host.querySelector<HTMLButtonElement>(".chat-composer-tools .chat-tool")!;
    await act(async () => { contextTool.click(); });
    expect(host.querySelector(".chat-context-panel")).toBeTruthy();

    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-context-actions button:last-child")!.click(); });
    expect(host.querySelector(".chat-context-panel")).toBeNull();

    await act(async () => { contextTool.click(); });
    expect(host.querySelector(".chat-context-panel")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(host.querySelector(".chat-context-panel")).toBeNull();
  });

  it("labels a history record with the mode symbol and its last activity", async () => {
    const store = createMemoryConversationStore();
    const conversation = await store.createConversation({ providerKind: "openai-compatible", model: "some-model", mode: "capture", title: "随心记 买菜" });
    await store.appendMessage(conversation.id, { role: "user", content: "买菜" });
    renderWith(store, "capture");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    const entry = host.querySelector(".chat-conversation-open")!;
    // The title drops the old mode prefix.
    expect(entry.querySelector("strong")?.textContent).toBe("买菜");
    // The history entry leads with the composer's symbol instead of a word.
    const badge = entry.querySelector(".chat-mode-badge.is-capture")!;
    expect(badge.getAttribute("title")).toBe("随心记");
    expect(badge.querySelector("svg")).toBeTruthy();
    expect(entry.querySelector("strong")?.firstElementChild).toBe(badge);
    expect(entry.querySelector("small")?.textContent).not.toContain("some-model");
    expect(entry.querySelector("small")?.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("gives an idea its own clock and shows the all-day hint", async () => {
    render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, "明天 14:00 团队复盘"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    const card = host.querySelector(".capture-review-card")!;
    expect(card.querySelector(".capture-review-allday")?.textContent).toBe("24h");

    // Switching the kind to an idea keeps a clock and reserves the status cell.
    await act(async () => { card.querySelector<HTMLButtonElement>(".capture-review-kind .glass-select-trigger")!.click(); });
    const ideaOption = [...document.querySelectorAll<HTMLButtonElement>(".glass-select-option")]
      .find((option) => option.textContent === "灵感")!;
    await act(async () => { ideaOption.click(); });
    expect(card.querySelector(".capture-review-kind")?.textContent).toContain("灵感");
    expect(card.querySelectorAll(".glass-time-trigger").length).toBe(1);
    // An idea carries no status box, so the kind control keeps its own edges.
    expect(card.querySelector(".capture-review-kind .glass-select.is-compact")).toBeNull();
  });

  it.each([false, "reject"] as const)("keeps the review editable when saving fails (%s)", async (failure) => {
    const onConfirm = vi.fn(async () => {
      if (failure === "reject") throw new Error("Save failed");
      return false;
    });
    render(onConfirm);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(textarea, "明天 14:00 开会，讨论预算"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(host.querySelectorAll(".capture-review-card")).toHaveLength(1);
    await act(async () => { host.querySelector<HTMLButtonElement>(".capture-review-confirm")!.click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".chat-capture-review")).toBeTruthy();
    expect(host.querySelector<HTMLButtonElement>(".capture-review-confirm")!.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>(".capture-review-title-input")!.disabled).toBe(false);
  });

  it("auto-saves an unchanged offline capture after ten seconds", async () => {
    vi.useFakeTimers({ now: new Date(), shouldAdvanceTime: true });
    try {
      const onConfirm = vi.fn(async () => true);
      render(onConfirm);
      await act(async () => { await vi.advanceTimersByTimeAsync(30); });
      const textarea = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      act(() => { setValue.call(textarea, "明天 14:00 开会"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
      await act(async () => { host.querySelector<HTMLButtonElement>(".chat-send")!.click(); await vi.advanceTimersByTimeAsync(30); });
      expect(host.querySelector(".chat-capture-review")).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(host.querySelector(".chat-capture-review")).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(onConfirm).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
