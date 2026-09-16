-- SQLite v7: atomic local change capture + causal sync state. Business data
-- stays in SQLite. No VACUUM/file swaps and no per-item remote files.
-- Attachment paths are ingest work, not canonical attachment data. The queue
-- converts existing display copies once; originals are never uploaded.
ALTER TABLE attachments RENAME TO attachments_before_sync;
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  sha256 TEXT CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  kind TEXT NOT NULL CHECK (kind IN ('image','file')),
  width INTEGER, height INTEGER, bytes INTEGER, mime TEXT, caption TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  file_missing INTEGER NOT NULL DEFAULT 0 CHECK (file_missing IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE attachment_ingest_queue (
  attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL
);
INSERT INTO attachments (id, entry_id, kind, width, height, bytes, mime, caption, sort, file_missing, created_at)
SELECT id, entry_id, kind, width, height, bytes, mime, caption, sort, 1, created_at FROM attachments_before_sync;
INSERT INTO attachment_ingest_queue (attachment_id, source_path)
SELECT id, local_path FROM attachments_before_sync;
DROP TABLE attachments_before_sync;
CREATE INDEX idx_attachments_entry_id ON attachments(entry_id);
CREATE INDEX idx_attachments_sha256 ON attachments(sha256);

CREATE TABLE sync_control (id INTEGER PRIMARY KEY CHECK(id = 1), applying INTEGER NOT NULL DEFAULT 0);
INSERT INTO sync_control (id, applying) VALUES (1, 0);
CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sync_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL, entity_id TEXT NOT NULL, data_json TEXT,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(entity,entity_id)
);
-- Coalesce not-yet-flushed local writes inside SQLite, including when no
-- backend is configured. Published/packed operation batches remain immutable.
CREATE TABLE sync_entities (entity TEXT NOT NULL, id TEXT NOT NULL, state_json TEXT NOT NULL, PRIMARY KEY(entity, id));
CREATE TABLE sync_links (entity TEXT NOT NULL, id TEXT NOT NULL, parent_entity TEXT NOT NULL, parent_id TEXT NOT NULL, PRIMARY KEY(entity,id,parent_entity,parent_id));
CREATE INDEX idx_sync_links_parent ON sync_links(parent_entity,parent_id);
CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, operation_json TEXT NOT NULL);
CREATE TABLE sync_batches (path TEXT PRIMARY KEY, content TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sync_documents (path TEXT PRIMARY KEY, hash TEXT NOT NULL, frontier_json TEXT);
CREATE TABLE sync_conflicts (entity TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, versions_json TEXT NOT NULL, PRIMARY KEY(entity,id,field));
CREATE TABLE sync_settings (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);

CREATE TRIGGER sync_entries_insert AFTER INSERT ON entries
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('entry', NEW.id, json_object('modality', NEW.modality, 'title', NEW.title, 'title_zh', NEW.title_zh, 'note', NEW.note, 'status', NEW.status, 'done_at', NEW.done_at, 'cancelled_at', NEW.cancelled_at, 'priority', NEW.priority, 'urgency', NEW.urgency, 'location', NEW.location, 'date', NEW.date, 'start_time', NEW.start_time, 'end_time', NEW.end_time, 'end_date', NEW.end_date, 'all_day', NEW.all_day, 'amount', NEW.amount, 'currency', NEW.currency, 'category', NEW.category, 'payment', NEW.payment, 'calendar', NEW.calendar, 'color', NEW.color, 'recurrence', NEW.recurrence, 'recurring_days', NEW.recurring_days, 'recurring_end', NEW.recurring_end, 'recurrence_exceptions', NEW.recurrence_exceptions, 'recurrence_moves', NEW.recurrence_moves, 'reminder', NEW.reminder, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'tags', json((SELECT json_group_array(tag) FROM (SELECT tag FROM entry_tags WHERE entry_id = NEW.id ORDER BY position, tag))))) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_entries_update AFTER UPDATE ON entries
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('entry', NEW.id, json_object('modality', NEW.modality, 'title', NEW.title, 'title_zh', NEW.title_zh, 'note', NEW.note, 'status', NEW.status, 'done_at', NEW.done_at, 'cancelled_at', NEW.cancelled_at, 'priority', NEW.priority, 'urgency', NEW.urgency, 'location', NEW.location, 'date', NEW.date, 'start_time', NEW.start_time, 'end_time', NEW.end_time, 'end_date', NEW.end_date, 'all_day', NEW.all_day, 'amount', NEW.amount, 'currency', NEW.currency, 'category', NEW.category, 'payment', NEW.payment, 'calendar', NEW.calendar, 'color', NEW.color, 'recurrence', NEW.recurrence, 'recurring_days', NEW.recurring_days, 'recurring_end', NEW.recurring_end, 'recurrence_exceptions', NEW.recurrence_exceptions, 'recurrence_moves', NEW.recurrence_moves, 'reminder', NEW.reminder, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'tags', json((SELECT json_group_array(tag) FROM (SELECT tag FROM entry_tags WHERE entry_id = NEW.id ORDER BY position, tag))))) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_entries_delete AFTER DELETE ON entries
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('entry', OLD.id, NULL) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
INSERT INTO sync_changes(entity, entity_id, data_json) SELECT 'entry', e.id, json_object('modality', e.modality, 'title', e.title, 'title_zh', e.title_zh, 'note', e.note, 'status', e.status, 'done_at', e.done_at, 'cancelled_at', e.cancelled_at, 'priority', e.priority, 'urgency', e.urgency, 'location', e.location, 'date', e.date, 'start_time', e.start_time, 'end_time', e.end_time, 'end_date', e.end_date, 'all_day', e.all_day, 'amount', e.amount, 'currency', e.currency, 'category', e.category, 'payment', e.payment, 'calendar', e.calendar, 'color', e.color, 'recurrence', e.recurrence, 'recurring_days', e.recurring_days, 'recurring_end', e.recurring_end, 'recurrence_exceptions', e.recurrence_exceptions, 'recurrence_moves', e.recurrence_moves, 'reminder', e.reminder, 'created_at', e.created_at, 'updated_at', e.updated_at, 'tags', json((SELECT json_group_array(tag) FROM (SELECT tag FROM entry_tags WHERE entry_id = e.id ORDER BY position, tag)))) FROM entries e WHERE 1 ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;

CREATE TRIGGER sync_attachments_insert AFTER INSERT ON attachments
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('attachment', NEW.id, json_object('entry_id', NEW.entry_id, 'sha256', NEW.sha256, 'kind', NEW.kind, 'width', NEW.width, 'height', NEW.height, 'bytes', NEW.bytes, 'mime', NEW.mime, 'caption', NEW.caption, 'sort', NEW.sort, 'created_at', NEW.created_at)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_attachments_update AFTER UPDATE ON attachments
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('attachment', NEW.id, json_object('entry_id', NEW.entry_id, 'sha256', NEW.sha256, 'kind', NEW.kind, 'width', NEW.width, 'height', NEW.height, 'bytes', NEW.bytes, 'mime', NEW.mime, 'caption', NEW.caption, 'sort', NEW.sort, 'created_at', NEW.created_at)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_attachments_delete AFTER DELETE ON attachments
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0 AND EXISTS (SELECT 1 FROM entries WHERE id=OLD.entry_id)
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('attachment', OLD.id, NULL) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
INSERT INTO sync_changes(entity, entity_id, data_json) SELECT 'attachment', e.id, json_object('entry_id', e.entry_id, 'sha256', e.sha256, 'kind', e.kind, 'width', e.width, 'height', e.height, 'bytes', e.bytes, 'mime', e.mime, 'caption', e.caption, 'sort', e.sort, 'created_at', e.created_at) FROM attachments e WHERE 1 ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;

CREATE TRIGGER sync_ai_conversations_insert AFTER INSERT ON ai_conversations
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('conversation', NEW.id, json_object('provider_kind', NEW.provider_kind, 'base_url', NEW.base_url, 'model', NEW.model, 'title', NEW.title, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'archived_at', NEW.archived_at, 'parent_entry_id', NEW.parent_entry_id)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_ai_conversations_update AFTER UPDATE ON ai_conversations
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('conversation', NEW.id, json_object('provider_kind', NEW.provider_kind, 'base_url', NEW.base_url, 'model', NEW.model, 'title', NEW.title, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'archived_at', NEW.archived_at, 'parent_entry_id', NEW.parent_entry_id)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_ai_conversations_delete AFTER DELETE ON ai_conversations
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('conversation', OLD.id, NULL) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
INSERT INTO sync_changes(entity, entity_id, data_json) SELECT 'conversation', e.id, json_object('provider_kind', e.provider_kind, 'base_url', e.base_url, 'model', e.model, 'title', e.title, 'created_at', e.created_at, 'updated_at', e.updated_at, 'archived_at', e.archived_at, 'parent_entry_id', e.parent_entry_id) FROM ai_conversations e WHERE 1 ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;

CREATE TRIGGER sync_ai_messages_insert AFTER INSERT ON ai_messages
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('message', NEW.id, json_object('conversation_id', NEW.conversation_id, 'role', NEW.role, 'content', NEW.content, 'reasoning_content', NEW.reasoning_content, 'prompt_tokens', NEW.prompt_tokens, 'completion_tokens', NEW.completion_tokens, 'created_at', NEW.created_at, 'proposed_entry_id', NEW.proposed_entry_id)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_ai_messages_update AFTER UPDATE ON ai_messages
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('message', NEW.id, json_object('conversation_id', NEW.conversation_id, 'role', NEW.role, 'content', NEW.content, 'reasoning_content', NEW.reasoning_content, 'prompt_tokens', NEW.prompt_tokens, 'completion_tokens', NEW.completion_tokens, 'created_at', NEW.created_at, 'proposed_entry_id', NEW.proposed_entry_id)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_ai_messages_delete AFTER DELETE ON ai_messages
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0 AND EXISTS (SELECT 1 FROM ai_conversations WHERE id=OLD.conversation_id)
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('message', OLD.id, NULL) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
INSERT INTO sync_changes(entity, entity_id, data_json) SELECT 'message', e.id, json_object('conversation_id', e.conversation_id, 'role', e.role, 'content', e.content, 'reasoning_content', e.reasoning_content, 'prompt_tokens', e.prompt_tokens, 'completion_tokens', e.completion_tokens, 'created_at', e.created_at, 'proposed_entry_id', e.proposed_entry_id) FROM ai_messages e WHERE 1 ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;

CREATE TRIGGER sync_tags_insert AFTER INSERT ON entry_tags
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json)
  SELECT 'entry', e.id, json_object('modality', e.modality, 'title', e.title, 'title_zh', e.title_zh, 'note', e.note, 'status', e.status, 'done_at', e.done_at, 'cancelled_at', e.cancelled_at, 'priority', e.priority, 'urgency', e.urgency, 'location', e.location, 'date', e.date, 'start_time', e.start_time, 'end_time', e.end_time, 'end_date', e.end_date, 'all_day', e.all_day, 'amount', e.amount, 'currency', e.currency, 'category', e.category, 'payment', e.payment, 'calendar', e.calendar, 'color', e.color, 'recurrence', e.recurrence, 'recurring_days', e.recurring_days, 'recurring_end', e.recurring_end, 'recurrence_exceptions', e.recurrence_exceptions, 'recurrence_moves', e.recurrence_moves, 'reminder', e.reminder, 'created_at', e.created_at, 'updated_at', e.updated_at, 'tags', json((SELECT json_group_array(tag) FROM (SELECT tag FROM entry_tags WHERE entry_id = e.id ORDER BY position, tag)))) FROM entries e WHERE e.id = NEW.entry_id ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_tags_update AFTER UPDATE ON entry_tags
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json)
  SELECT 'entry', e.id, json_object('modality', e.modality, 'title', e.title, 'title_zh', e.title_zh, 'note', e.note, 'status', e.status, 'done_at', e.done_at, 'cancelled_at', e.cancelled_at, 'priority', e.priority, 'urgency', e.urgency, 'location', e.location, 'date', e.date, 'start_time', e.start_time, 'end_time', e.end_time, 'end_date', e.end_date, 'all_day', e.all_day, 'amount', e.amount, 'currency', e.currency, 'category', e.category, 'payment', e.payment, 'calendar', e.calendar, 'color', e.color, 'recurrence', e.recurrence, 'recurring_days', e.recurring_days, 'recurring_end', e.recurring_end, 'recurrence_exceptions', e.recurrence_exceptions, 'recurrence_moves', e.recurrence_moves, 'reminder', e.reminder, 'created_at', e.created_at, 'updated_at', e.updated_at, 'tags', json((SELECT json_group_array(tag) FROM (SELECT tag FROM entry_tags WHERE entry_id = e.id ORDER BY position, tag)))) FROM entries e WHERE e.id = NEW.entry_id ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_tags_delete AFTER DELETE ON entry_tags
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json)
  SELECT 'entry', e.id, json_object('modality', e.modality, 'title', e.title, 'title_zh', e.title_zh, 'note', e.note, 'status', e.status, 'done_at', e.done_at, 'cancelled_at', e.cancelled_at, 'priority', e.priority, 'urgency', e.urgency, 'location', e.location, 'date', e.date, 'start_time', e.start_time, 'end_time', e.end_time, 'end_date', e.end_date, 'all_day', e.all_day, 'amount', e.amount, 'currency', e.currency, 'category', e.category, 'payment', e.payment, 'calendar', e.calendar, 'color', e.color, 'recurrence', e.recurrence, 'recurring_days', e.recurring_days, 'recurring_end', e.recurring_end, 'recurrence_exceptions', e.recurrence_exceptions, 'recurrence_moves', e.recurrence_moves, 'reminder', e.reminder, 'created_at', e.created_at, 'updated_at', e.updated_at, 'tags', json((SELECT json_group_array(tag) FROM (SELECT tag FROM entry_tags WHERE entry_id = e.id ORDER BY position, tag)))) FROM entries e WHERE e.id = OLD.entry_id ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_settings_insert AFTER INSERT ON sync_settings
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('settings', NEW.id, NEW.payload_json) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

CREATE TRIGGER sync_settings_update AFTER UPDATE ON sync_settings
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('settings', NEW.id, NEW.payload_json) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
