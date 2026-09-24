import type { EntityKind } from "./protocol";

export const ENTITY_TABLES: Record<Exclude<EntityKind, "settings">, { table: string; columns: string[] }> = {
  entry: { table: "entries", columns: ["modality", "title", "title_zh", "note", "status", "done_at", "cancelled_at", "priority", "urgency", "location", "date", "start_time", "end_time", "end_date", "all_day", "amount", "currency", "category", "payment", "calendar", "color", "recurrence", "recurring_days", "recurring_end", "recurrence_exceptions", "recurrence_moves", "reminder", "created_at", "updated_at"] },
  attachment: { table: "attachments", columns: ["entry_id", "sha256", "kind", "width", "height", "bytes", "mime", "caption", "sort", "created_at"] },
  conversation: { table: "ai_conversations", columns: ["provider_kind", "base_url", "model", "title", "mode", "created_at", "updated_at", "archived_at", "parent_entry_id"] },
  message: { table: "ai_messages", columns: ["conversation_id", "role", "content", "reasoning_content", "prompt_tokens", "completion_tokens", "created_at", "proposed_entry_id"] },
};
