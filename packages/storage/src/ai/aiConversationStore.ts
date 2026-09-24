import { nextTimestamp } from "../persistence/timestamp";
import { runDatabaseOperation, notifyLocalChange } from "../persistence/coordinator";
import { createEntryId } from "@chronoeon/domain";
import { StorageError } from "../errors";
import type { PersistencePort, SqlParam } from "../persistence/PersistencePort";

export type AiConversationProviderKind = "openai-compatible" | "local-openai-compatible";
export type AiMessageRole = "system" | "user" | "assistant";
/** Which composer produced the conversation; the history rail follows it. */
export type AiConversationMode = "capture" | "ask";

export interface AiConversation {
  id: string;
  providerKind: AiConversationProviderKind;
  baseUrl?: string;
  model?: string;
  title?: string;
  mode: AiConversationMode;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  parentEntryId?: string;
}

export interface AiMessageRecord {
  id: string;
  conversationId: string;
  role: AiMessageRole;
  content: string;
  reasoningContent?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  createdAt: string;
  proposedEntryId?: string | null;
}

export interface NewAiConversation {
  providerKind: AiConversationProviderKind;
  baseUrl?: string;
  model?: string;
  title?: string;
  mode?: AiConversationMode;
  parentEntryId?: string;
}

export interface NewAiMessage {
  role: AiMessageRole;
  content: string;
  reasoningContent?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  proposedEntryId?: string | null;
}

/**
 * A parsed capture review waiting for the user's confirmation. It is local UI
 * state for one conversation — the drafts never sync, so the payload stays an
 * opaque JSON array owned by the caller.
 */
export interface AiCaptureReviewRecord {
  conversationId: string;
  messageId: string;
  source: string;
  drafts: unknown[];
  edited: boolean;
  saved: boolean;
  updatedAt: string;
}

interface ConversationRow {
  id: string;
  provider_kind: string;
  base_url: string | null;
  model: string | null;
  title: string | null;
  mode: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  parent_entry_id: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  reasoning_content: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: string;
  proposed_entry_id: string | null;
}

interface CaptureReviewRow {
  conversation_id: string;
  message_id: string;
  source: string;
  drafts_json: string;
  edited: number;
  saved: number;
  updated_at: string;
}

const CONVERSATION_COLUMNS = "id, provider_kind, base_url, model, title, mode, created_at, updated_at, archived_at, parent_entry_id";
const MESSAGE_COLUMNS = "id, conversation_id, role, content, reasoning_content, prompt_tokens, completion_tokens, created_at, proposed_entry_id";

function conversationFromRow(row: ConversationRow): AiConversation {
  return {
    id: row.id,
    providerKind: row.provider_kind as AiConversationProviderKind,
    baseUrl: row.base_url ?? undefined,
    model: row.model ?? undefined,
    title: row.title ?? undefined,
    // A peer that has not migrated yet publishes no mode; those rows stay Ask.
    mode: row.mode === "capture" ? "capture" : "ask",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
    parentEntryId: row.parent_entry_id ?? undefined,
  };
}

function messageFromRow(row: MessageRow): AiMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as AiMessageRole,
    content: row.content,
    reasoningContent: row.reasoning_content,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    createdAt: row.created_at,
    proposedEntryId: row.proposed_entry_id,
  };
}

/** Typed persistence API around `ai_conversations` + `ai_messages`; no UI wiring here. */
export class AiConversationStore {
  constructor(private readonly backend: PersistencePort) {}
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  notifyRebuilt(): void { for (const listener of this.listeners) listener(); }
  createConversation(input: NewAiConversation): Promise<AiConversation> {
    return runDatabaseOperation(this.backend, async () => {
      const result = await this.createConversationDirect(input);
      notifyLocalChange(this.backend); this.notifyRebuilt();
      return result;
    });
  }
  listConversations(options: { includeArchived?: boolean } = {}): Promise<AiConversation[]> {
    return runDatabaseOperation(this.backend, async () => {
      const result = await this.listConversationsDirect(options);
      return result;
    });
  }
  getConversation(id: string): Promise<AiConversation | null> {
    return runDatabaseOperation(this.backend, async () => {
      const result = await this.getConversationDirect(id);
      return result;
    });
  }
  appendMessage(conversationId: string, input: NewAiMessage): Promise<AiMessageRecord> {
    return runDatabaseOperation(this.backend, async () => {
      const result = await this.appendMessageDirect(conversationId, input);
      notifyLocalChange(this.backend); this.notifyRebuilt();
      return result;
    });
  }
  listMessages(conversationId: string): Promise<AiMessageRecord[]> {
    return runDatabaseOperation(this.backend, async () => {
      const result = await this.listMessagesDirect(conversationId);
      return result;
    });
  }
  archiveConversation(id: string, archivedAt = new Date().toISOString()): Promise<void> {
    return runDatabaseOperation(this.backend, async () => {
      const result = await this.archiveConversationDirect(id, archivedAt);
      notifyLocalChange(this.backend); this.notifyRebuilt();
      return result;
    });
  }
  renameConversation(id: string, title: string): Promise<void> {
    return runDatabaseOperation(this.backend, async () => {
      const result = await this.renameConversationDirect(id, title);
      notifyLocalChange(this.backend); this.notifyRebuilt();
      return result;
    });
  }
  unarchiveConversation(id: string): Promise<void> {
    return runDatabaseOperation(this.backend, async () => {
      const result = await this.unarchiveConversationDirect(id);
      notifyLocalChange(this.backend); this.notifyRebuilt();
      return result;
    });
  }
  deleteConversation(id: string): Promise<void> {
    return runDatabaseOperation(this.backend, async () => {
      const result = await this.deleteConversationDirect(id);
      notifyLocalChange(this.backend); this.notifyRebuilt();
      return result;
    });
  }

  /** Persist the pending review so closing the dialog cannot lose it. */
  saveCaptureReview(review: AiCaptureReviewRecord): Promise<void> {
    return runDatabaseOperation(this.backend, async () => {
      await this.backend.execute(
        `INSERT INTO ai_capture_reviews (conversation_id, message_id, source, drafts_json, edited, saved, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET message_id=excluded.message_id, source=excluded.source,
           drafts_json=excluded.drafts_json, edited=excluded.edited, saved=excluded.saved, updated_at=excluded.updated_at`,
        [review.conversationId, review.messageId, review.source, JSON.stringify(review.drafts),
          review.edited ? 1 : 0, review.saved ? 1 : 0, review.updatedAt],
      );
    });
  }

  loadCaptureReview(conversationId: string): Promise<AiCaptureReviewRecord | null> {
    return runDatabaseOperation(this.backend, async () => {
      const rows = await this.backend.select<CaptureReviewRow>(
        "SELECT conversation_id, message_id, source, drafts_json, edited, saved, updated_at FROM ai_capture_reviews WHERE conversation_id = ?",
        [conversationId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        conversationId: row.conversation_id,
        messageId: row.message_id,
        source: row.source,
        drafts: JSON.parse(row.drafts_json) as unknown[],
        edited: row.edited === 1,
        saved: row.saved === 1,
        updatedAt: row.updated_at,
      };
    });
  }

  deleteCaptureReview(conversationId: string): Promise<void> {
    return runDatabaseOperation(this.backend, async () => {
      await this.backend.execute("DELETE FROM ai_capture_reviews WHERE conversation_id = ?", [conversationId]);
    });
  }


  private async createConversationDirect(input: NewAiConversation): Promise<AiConversation> {
    const now = new Date().toISOString();
    const row: Record<string, SqlParam> = {
      id: createEntryId(),
      provider_kind: input.providerKind,
      base_url: input.baseUrl ?? null,
      model: input.model ?? null,
      title: input.title ?? null,
      mode: input.mode ?? "ask",
      created_at: now,
      updated_at: now,
      archived_at: null,
      parent_entry_id: input.parentEntryId ?? null,
    };
    await this.insert("ai_conversations", CONVERSATION_COLUMNS.split(", "), Object.values(row));
    const created = await this.getConversationDirect(String(row.id));
    if (!created) throw new StorageError("PersistenceFailed", "Conversation could not be read back after insert");
    return created;
  }

  private async listConversationsDirect(options: { includeArchived?: boolean } = {}): Promise<AiConversation[]> {
    const archivedFilter = options.includeArchived ? "" : "WHERE archived_at IS NULL";
    const rows = await this.backend.select<ConversationRow>(
      `SELECT ${CONVERSATION_COLUMNS} FROM ai_conversations ${archivedFilter} ORDER BY updated_at DESC`
    );
    return rows.map(conversationFromRow);
  }

  private async getConversationDirect(id: string): Promise<AiConversation | null> {
    const rows = await this.backend.select<ConversationRow>(`SELECT ${CONVERSATION_COLUMNS} FROM ai_conversations WHERE id = ?`, [id]);
    return rows[0] ? conversationFromRow(rows[0]) : null;
  }

  /** Persist one message and bump the conversation's updated_at. */
  private async appendMessageDirect(conversationId: string, input: NewAiMessage): Promise<AiMessageRecord> {
    const conversation = await this.getConversationDirect(conversationId);
    if (!conversation) {
      throw new StorageError("PersistenceFailed", `Conversation ${conversationId} does not exist (FK violation)`);
    }
    const now = nextTimestamp(conversation.updatedAt);
    const id = createEntryId();
    await this.backend.transaction(async () => {
      await this.insert("ai_messages", MESSAGE_COLUMNS.split(", "), [
        id, conversationId, input.role, input.content, input.reasoningContent ?? null, input.promptTokens ?? null,
        input.completionTokens ?? null, now, input.proposedEntryId ?? null,
      ]);
      await this.backend.execute("UPDATE ai_conversations SET updated_at = ? WHERE id = ?", [now, conversationId]);
    });
    const messages = await this.listMessagesDirect(conversationId);
    const created = messages.find((message) => message.id === id);
    if (!created) throw new StorageError("PersistenceFailed", "Message could not be read back after insert");
    return created;
  }

  private async listMessagesDirect(conversationId: string): Promise<AiMessageRecord[]> {
    const rows = await this.backend.select<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM ai_messages WHERE conversation_id = ? ORDER BY created_at, id`, [conversationId],
    );
    return rows.map(messageFromRow);
  }

  private async archiveConversationDirect(id: string, archivedAt = new Date().toISOString()): Promise<void> {
    await this.backend.execute("UPDATE ai_conversations SET archived_at = ? WHERE id = ?", [archivedAt, id]);
  }

  private async renameConversationDirect(id: string, title: string): Promise<void> {
    await this.backend.execute("UPDATE ai_conversations SET title = ? WHERE id = ?", [title || null, id]);
  }

  private async unarchiveConversationDirect(id: string): Promise<void> {
    await this.backend.execute("UPDATE ai_conversations SET archived_at = NULL WHERE id = ?", [id]);
  }

  /** Deletes the conversation; messages cascade via the foreign key. */
  private async deleteConversationDirect(id: string): Promise<void> {
    await this.backend.execute("DELETE FROM ai_conversations WHERE id = ?", [id]);
  }

  updateMessage(id: string, content: string): Promise<void> {
    return runDatabaseOperation(this.backend, async () => {
      await this.backend.transaction(async () => {
        const conversations = await this.backend.select<{id:string; updated_at:string}>("SELECT id,updated_at FROM ai_conversations WHERE id=(SELECT conversation_id FROM ai_messages WHERE id=?)", [id]);
        if (conversations[0]) await this.backend.execute("UPDATE ai_conversations SET updated_at=? WHERE id=?", [nextTimestamp(conversations[0].updated_at),conversations[0].id]);
        await this.backend.execute("UPDATE ai_messages SET content = ? WHERE id = ?", [content, id]);
      });
      notifyLocalChange(this.backend); this.notifyRebuilt();
    });
  }
  deleteMessage(id: string): Promise<void> {
    return runDatabaseOperation(this.backend, async () => {
      await this.backend.transaction(async () => {
        const conversations = await this.backend.select<{id:string; updated_at:string}>("SELECT id,updated_at FROM ai_conversations WHERE id=(SELECT conversation_id FROM ai_messages WHERE id=?)", [id]);
        if (conversations[0]) await this.backend.execute("UPDATE ai_conversations SET updated_at=? WHERE id=?", [nextTimestamp(conversations[0].updated_at),conversations[0].id]);
        await this.backend.execute("DELETE FROM ai_messages WHERE id = ?", [id]);
      });
      notifyLocalChange(this.backend); this.notifyRebuilt();
    });
  }

  private async insert(table: string, columns: string[], values: SqlParam[]): Promise<void> {
    await this.backend.execute(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.map(() => "?").join(", ")})`,
      values,
    );
  }
}
