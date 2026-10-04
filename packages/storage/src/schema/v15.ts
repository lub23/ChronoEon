// The column lists are frozen to schema v15, not the evolving sync schema.
const tables: Array<{ name: string; keys: string[]; columns: string[] }> = [
  { name: "entries", keys: ["id"], columns: ["id", "modality", "title", "title_zh", "note", "status", "done_at", "cancelled_at", "priority", "urgency", "location", "date", "start_time", "end_time", "end_date", "all_day", "amount", "currency", "category", "payment", "calendar", "color", "recurrence", "recurring_days", "recurring_end", "recurrence_exceptions", "recurrence_moves", "reminder", "created_at", "updated_at"] },
  { name: "items", keys: ["id"], columns: ["id", "name", "calendar", "category", "acquisition", "acquired_on", "acquired_at", "cost", "currency", "location", "payment", "purchase_entry_id", "disposal", "disposed_on", "sale_amount", "sale_entry_id", "images_json", "notes", "created_at", "updated_at"] },
  { name: "entry_tags", keys: ["entry_id", "tag"], columns: ["entry_id", "tag", "position"] },
  { name: "attachments", keys: ["id"], columns: ["id", "entry_id", "sha256", "kind", "width", "height", "bytes", "mime", "caption", "sort", "file_missing", "created_at"] },
  { name: "attachment_ingest_queue", keys: ["attachment_id"], columns: ["attachment_id", "source_path"] },
  { name: "sync_settings", keys: ["id"], columns: ["id", "payload_json"] },
  { name: "ai_conversations", keys: ["id"], columns: ["id", "provider_kind", "base_url", "model", "title", "mode", "created_at", "updated_at", "archived_at", "parent_entry_id"] },
  { name: "ai_messages", keys: ["id"], columns: ["id", "conversation_id", "role", "content", "reasoning_content", "prompt_tokens", "completion_tokens", "created_at", "proposed_entry_id"] },
];

const triggers = tables.flatMap(({ name, keys, columns }) => ["INSERT", "UPDATE", "DELETE"].map(event => {
  const ref = event === "DELETE" ? "OLD" : "NEW";
  const json = (row: string) => `json_object(${columns.map(column => `'${column}',${row}.${column}`).join(",")})`;
  const before = event === "INSERT" ? "NULL" : json("OLD");
  const after = event === "DELETE" ? "NULL" : json("NEW");
  return `CREATE TRIGGER history_${name}_${event.toLowerCase()} AFTER ${event} ON ${name}
WHEN (SELECT operation_id FROM history_control WHERE id=1) IS NOT NULL
BEGIN
  INSERT INTO operation_history_changes(operation_id,table_name,row_key,before_json,after_json)
  VALUES ((SELECT operation_id FROM history_control WHERE id=1),'${name}',json_array(${keys.map(key => `${ref}.${key}`).join(",")}),${before},${after})
  ON CONFLICT(operation_id,table_name,row_key) DO UPDATE SET after_json=excluded.after_json;
END;`;
})).join("\n");

export const SCHEMA_V15_SQL = `
CREATE TABLE operation_history (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  restored_from TEXT
);
CREATE INDEX idx_operation_history_created ON operation_history(created_at);
CREATE TABLE operation_history_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL REFERENCES operation_history(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  UNIQUE(operation_id,table_name,row_key)
);
CREATE TABLE history_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  operation_id TEXT REFERENCES operation_history(id)
);
INSERT INTO history_control(id) VALUES(1);
${triggers}
`;
