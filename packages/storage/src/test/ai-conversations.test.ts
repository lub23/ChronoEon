import { describe, expect, it } from "vitest";
import { AiConversationStore } from "../ai/aiConversationStore";
import { openMemoryStore } from "./helpers";

describe("ai conversation persistence", () => {
  it("round-trips conversations and messages with token fields", async () => {
    const { backend, store } = await openMemoryStore();
    const conversations = new AiConversationStore(backend);

    const conversation = await conversations.createConversation({
      providerKind: "openai-compatible",
      baseUrl: "https://example.invalid/v1",
      model: "demo-model",
      title: "Budget review",
    });
    expect(conversation.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(conversation.archivedAt).toBeUndefined();

    const user = await conversations.appendMessage(conversation.id, {
      role: "user", content: "Summarize my bills", promptTokens: null, completionTokens: null,
    });
    const assistant = await conversations.appendMessage(conversation.id, {
      role: "assistant", content: "You spent 42 this month", promptTokens: 120, completionTokens: 24,
    });
    expect(user.promptTokens).toBeNull();
    expect(assistant.promptTokens).toBe(120);
    expect(assistant.completionTokens).toBe(24);

    const messages = await conversations.listMessages(conversation.id);
    expect(messages.map((message) => message.content)).toEqual(["Summarize my bills", "You spent 42 this month"]);

    const listed = await conversations.listConversations();
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("Budget review");

    // The entry store remains untouched by conversation writes.
    expect(await store.isEmpty()).toBe(true);
  });

  it("bumps updated_at on append and hides archived conversations by default", async () => {
    const { backend } = await openMemoryStore();
    const conversations = new AiConversationStore(backend);
    const first = await conversations.createConversation({ providerKind: "local-openai-compatible" });
    const before = first.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await conversations.appendMessage(first.id, { role: "user", content: "hello" });
    const after = (await conversations.getConversation(first.id))!;
    expect(after.updatedAt >= before).toBe(true);

    await conversations.archiveConversation(first.id, "2026-08-10T12:00:00.000Z");
    expect(await conversations.listConversations()).toHaveLength(0);
    expect(await conversations.listConversations({ includeArchived: true })).toHaveLength(1);
    expect((await conversations.getConversation(first.id))?.archivedAt).toBe("2026-08-10T12:00:00.000Z");

    await conversations.unarchiveConversation(first.id);
    expect(await conversations.listConversations()).toHaveLength(1);
  });

  it("cascades message deletion with the conversation", async () => {
    const { backend } = await openMemoryStore();
    const conversations = new AiConversationStore(backend);
    const conversation = await conversations.createConversation({ providerKind: "openai-compatible" });
    await conversations.appendMessage(conversation.id, { role: "user", content: "one" });
    await conversations.appendMessage(conversation.id, { role: "assistant", content: "two" });

    await conversations.deleteConversation(conversation.id);
    const messages = await backend.select("SELECT * FROM ai_messages WHERE conversation_id = ?", [conversation.id]);
    expect(messages).toEqual([]);
    expect(await conversations.getConversation(conversation.id)).toBeNull();
  });

  it("rejects appending to a missing conversation", async () => {
    const { backend } = await openMemoryStore();
    const conversations = new AiConversationStore(backend);
    await expect(conversations.appendMessage("00000000-0000-4000-8000-00000000dead", {
      role: "user", content: "orphan",
    })).rejects.toThrow(/does not exist/);
  });

  it("renames a conversation (auto-title path)", async () => {
    const { backend } = await openMemoryStore();
    const conversations = new AiConversationStore(backend);
    const conversation = await conversations.createConversation({ providerKind: "openai-compatible" });
    await conversations.renameConversation(conversation.id, "First user message…");
    expect((await conversations.getConversation(conversation.id))?.title).toBe("First user message…");
    await conversations.renameConversation(conversation.id, "");
    expect((await conversations.getConversation(conversation.id))?.title).toBeUndefined();
  });

  it("keeps proposed_entry_id across a round trip", async () => {
    const { backend, store } = await openMemoryStore();
    const conversations = new AiConversationStore(backend);
    const proposal = await store.create({
      id: "00000000-0000-4000-8000-000000000042",
      kind: "task",
      title: "Proposed",
      date: "2026-08-10",
      allDay: true,
      category: "work",
      calendar: "default",
      color: "#77787b",
      createdAt: new Date().toISOString(),
    });
    const conversation = await conversations.createConversation({ providerKind: "openai-compatible" });
    const message = await conversations.appendMessage(conversation.id, {
      role: "assistant",
      content: "Proposal",
      proposedEntryId: proposal.id,
    });
    expect(message.proposedEntryId).toBe(proposal.id);
    const messages = await conversations.listMessages(conversation.id);
    expect(messages[0].proposedEntryId).toBe(proposal.id);
  });
});
