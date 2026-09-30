-- SQLite v14: assets belong to a calendar so each calendar owns its catalog system.
ALTER TABLE items ADD COLUMN calendar TEXT NOT NULL DEFAULT 'default';
UPDATE items SET calendar = 'default' WHERE calendar = '';
UPDATE items
SET acquired_at = substr(acquired_at, -5)
WHERE acquired_at GLOB '????-??-??T??:??';
UPDATE sync_changes
SET data_json = json_set(data_json, '$.acquired_at', substr(json_extract(data_json, '$.acquired_at'), -5))
WHERE entity = 'asset'
  AND json_extract(data_json, '$.acquired_at') GLOB '????-??-??T??:??';

DROP TRIGGER IF EXISTS sync_items_insert;
DROP TRIGGER IF EXISTS sync_items_update;
DROP TRIGGER IF EXISTS sync_items_delete;
CREATE TRIGGER sync_items_insert AFTER INSERT ON items
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', NEW.id, json_object(
    'name', NEW.name, 'calendar', NEW.calendar, 'category', NEW.category, 'acquisition', NEW.acquisition,
    'acquired_on', NEW.acquired_on, 'acquired_at', NEW.acquired_at, 'cost', NEW.cost,
    'currency', NEW.currency, 'location', NEW.location, 'payment', NEW.payment,
    'purchase_entry_id', NEW.purchase_entry_id, 'disposal', NEW.disposal,
    'disposed_on', NEW.disposed_on, 'sale_amount', NEW.sale_amount,
    'sale_entry_id', NEW.sale_entry_id, 'images_json', NEW.images_json,
    'notes', NEW.notes, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at
  )) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
CREATE TRIGGER sync_items_update AFTER UPDATE ON items
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', NEW.id, json_object(
    'name', NEW.name, 'calendar', NEW.calendar, 'category', NEW.category, 'acquisition', NEW.acquisition,
    'acquired_on', NEW.acquired_on, 'acquired_at', NEW.acquired_at, 'cost', NEW.cost,
    'currency', NEW.currency, 'location', NEW.location, 'payment', NEW.payment,
    'purchase_entry_id', NEW.purchase_entry_id, 'disposal', NEW.disposal,
    'disposed_on', NEW.disposed_on, 'sale_amount', NEW.sale_amount,
    'sale_entry_id', NEW.sale_entry_id, 'images_json', NEW.images_json,
    'notes', NEW.notes, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at
  )) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
CREATE TRIGGER sync_items_delete AFTER DELETE ON items
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', OLD.id, NULL)
  ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
