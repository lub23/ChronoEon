-- SQLite v9: a conversation remembers which composer produced it, so opening a
-- history entry can follow its own Capture/Ask mode instead of guessing from a
-- localized title prefix. The default keeps older rows usable; existing
-- conversations are labelled from the marker the app already wrote into titles.

ALTER TABLE ai_conversations ADD COLUMN mode TEXT DEFAULT 'ask' CHECK (mode IS NULL OR mode IN ('capture', 'ask'));

UPDATE ai_conversations SET mode = 'capture' WHERE title LIKE '随心记 %' OR title LIKE 'Capture %';

DROP TRIGGER sync_ai_conversations_insert;
CREATE TRIGGER sync_ai_conversations_insert AFTER INSERT ON ai_conversations
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('conversation', NEW.id, json_object('provider_kind', NEW.provider_kind, 'base_url', NEW.base_url, 'model', NEW.model, 'title', NEW.title, 'mode', NEW.mode, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'archived_at', NEW.archived_at, 'parent_entry_id', NEW.parent_entry_id)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

DROP TRIGGER sync_ai_conversations_update;
CREATE TRIGGER sync_ai_conversations_update AFTER UPDATE ON ai_conversations
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('conversation', NEW.id, json_object('provider_kind', NEW.provider_kind, 'base_url', NEW.base_url, 'model', NEW.model, 'title', NEW.title, 'mode', NEW.mode, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'archived_at', NEW.archived_at, 'parent_entry_id', NEW.parent_entry_id)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;

INSERT INTO sync_changes(entity, entity_id, data_json) SELECT 'conversation', e.id, json_object('provider_kind', e.provider_kind, 'base_url', e.base_url, 'model', e.model, 'title', e.title, 'mode', e.mode, 'created_at', e.created_at, 'updated_at', e.updated_at, 'archived_at', e.archived_at, 'parent_entry_id', e.parent_entry_id) FROM ai_conversations e WHERE 1 ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
