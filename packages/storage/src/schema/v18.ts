// Items gain tags and an exact disposal clock. Both the sync and the history
// triggers list item columns explicitly, so each is recreated with the new
// columns; the earlier definitions stay untouched in their own steps.
const ITEM_COLUMNS = ["id", "name", "calendar", "category", "acquisition", "acquired_on", "acquired_at", "cost", "currency", "location", "payment", "purchase_entry_id", "disposal", "disposed_on", "disposed_at", "sale_amount", "sale_entry_id", "images_json", "notes", "tags_json", "created_at", "updated_at"];

const syncJson = ITEM_COLUMNS.filter((column) => column !== "id").map((column) => `'${column}', NEW.${column}`).join(", ");
const syncTrigger = (event: "INSERT" | "UPDATE") => `CREATE TRIGGER sync_items_${event.toLowerCase()} AFTER ${event} ON items
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', NEW.id, json_object(${syncJson}))
  ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;`;

const historyTriggers = ["INSERT", "UPDATE", "DELETE"].map((event) => {
  const ref = event === "DELETE" ? "OLD" : "NEW";
  const json = (row: string) => `json_object(${ITEM_COLUMNS.map((column) => `'${column}',${row}.${column}`).join(",")})`;
  const before = event === "INSERT" ? "NULL" : json("OLD");
  const after = event === "DELETE" ? "NULL" : json("NEW");
  return `CREATE TRIGGER history_items_${event.toLowerCase()} AFTER ${event} ON items
WHEN (SELECT operation_id FROM history_control WHERE id=1) IS NOT NULL
BEGIN
  INSERT INTO operation_history_changes(operation_id,table_name,row_key,before_json,after_json)
  VALUES ((SELECT operation_id FROM history_control WHERE id=1),'items',json_array(${ref}.id),${before},${after})
  ON CONFLICT(operation_id,table_name,row_key) DO UPDATE SET after_json=excluded.after_json;
END;`;
}).join("\n");

export const SCHEMA_V18_SQL = `
ALTER TABLE items ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE items ADD COLUMN disposed_at TEXT;
DROP TRIGGER IF EXISTS sync_items_insert;
DROP TRIGGER IF EXISTS sync_items_update;
${syncTrigger("INSERT")}
${syncTrigger("UPDATE")}
DROP TRIGGER IF EXISTS history_items_insert;
DROP TRIGGER IF EXISTS history_items_update;
DROP TRIGGER IF EXISTS history_items_delete;
${historyTriggers}
`;
