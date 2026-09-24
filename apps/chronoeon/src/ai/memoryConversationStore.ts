import { createEntryId } from "@chronoeon/domain";
import type {
  AiCaptureReviewRecord,
  AiConversation,
  AiMessageRecord,
  NewAiConversation,
  NewAiMessage,
} from "@chronoeon/storage";

interface MemoryConversation extends AiConversation {
  messages: AiMessageRecord[];
}

/** The public conversation API shared by the SQLite store and the demo store. */
export interface AiConversationApi {
  createConversation(input: NewAiConversation): Promise<AiConversation>;
  listConversations(options?: { includeArchived?: boolean }): Promise<AiConversation[]>;
  getConversation(id: string): Promise<AiConversation | null>;
  appendMessage(conversationId: string, input: NewAiMessage): Promise<AiMessageRecord>;
  listMessages(conversationId: string): Promise<AiMessageRecord[]>;
  archiveConversation(id: string): Promise<void>;
  renameConversation(id: string, title: string): Promise<void>;
  unarchiveConversation(id: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  /** Local-only draft state, kept next to the conversation it belongs to. */
  saveCaptureReview(review: AiCaptureReviewRecord): Promise<void>;
  loadCaptureReview(conversationId: string): Promise<AiCaptureReviewRecord | null>;
  deleteCaptureReview(conversationId: string): Promise<void>;
}

/**
 * Browser builds have no SQLite. The chat still has to be usable in the demo
 * shell, so this store keeps conversations in memory for the current page —
 * never localStorage, never exported, and never used on Tauri where the real
 * `AiConversationStore` owns the same interface.
 */
export function createMemoryConversationStore(): AiConversationApi {
  const conversations = new Map<string, MemoryConversation>();
  const reviews = new Map<string, AiCaptureReviewRecord>();

  return {
    async createConversation(input: NewAiConversation): Promise<AiConversation> {
      const now = new Date().toISOString();
      const conversation: MemoryConversation = {
        id: createEntryId(),
        providerKind: input.providerKind,
        baseUrl: input.baseUrl,
        model: input.model,
        title: input.title,
        mode: input.mode ?? "ask",
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    async listConversations(options: { includeArchived?: boolean } = {}): Promise<AiConversation[]> {
      return [...conversations.values()]
        .filter((conversation) => options.includeArchived || !conversation.archivedAt)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(({ messages: _messages, ...conversation }) => conversation);
    },
    async getConversation(id: string): Promise<AiConversation | null> {
      const conversation = conversations.get(id);
      if (!conversation) return null;
      const { messages: _messages, ...rest } = conversation;
      return rest;
    },
    async appendMessage(conversationId: string, input: NewAiMessage): Promise<AiMessageRecord> {
      const conversation = conversations.get(conversationId);
      if (!conversation) throw new Error(`Conversation ${conversationId} does not exist`);
      const now = new Date().toISOString();
      const message: AiMessageRecord = {
        id: createEntryId(),
        conversationId,
        role: input.role,
        content: input.content,
        reasoningContent: input.reasoningContent ?? null,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        createdAt: now,
        proposedEntryId: input.proposedEntryId ?? null,
      };
      conversation.messages.push(message);
      conversation.updatedAt = now;
      return message;
    },
    async listMessages(conversationId: string): Promise<AiMessageRecord[]> {
      return [...(conversations.get(conversationId)?.messages ?? [])].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      );
    },
    async archiveConversation(id: string): Promise<void> {
      const conversation = conversations.get(id);
      if (conversation) conversation.archivedAt = new Date().toISOString();
    },
    async renameConversation(id: string, title: string): Promise<void> {
      const conversation = conversations.get(id);
      if (conversation) conversation.title = title || undefined;
    },
    async unarchiveConversation(id: string): Promise<void> {
      const conversation = conversations.get(id);
      if (conversation) conversation.archivedAt = undefined;
    },
    async deleteConversation(id: string): Promise<void> {
      conversations.delete(id);
      reviews.delete(id);
    },
    async saveCaptureReview(review: AiCaptureReviewRecord): Promise<void> {
      if (!conversations.has(review.conversationId)) throw new Error(`Conversation ${review.conversationId} does not exist`);
      reviews.set(review.conversationId, structuredClone(review));
    },
    async loadCaptureReview(conversationId: string): Promise<AiCaptureReviewRecord | null> {
      const review = reviews.get(conversationId);
      return review ? structuredClone(review) : null;
    },
    async deleteCaptureReview(conversationId: string): Promise<void> {
      reviews.delete(conversationId);
    },
  };
}
