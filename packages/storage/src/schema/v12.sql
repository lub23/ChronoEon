-- SQLite v12: items get exact acquisition time and are no longer called assets.
DROP TRIGGER IF EXISTS sync_assets_insert;
DROP TRIGGER IF EXISTS sync_assets_update;
DROP TRIGGER IF EXISTS sync_assets_delete;
ALTER TABLE assets RENAME TO items;
ALTER TABLE items ADD COLUMN acquired_at TEXT NOT NULL DEFAULT '';
UPDATE items SET acquired_at = acquired_on || 'T09:00' WHERE acquired_at = '';
UPDATE sync_changes SET data_json = json_set(data_json, '$.acquired_at', json_extract(data_json, '$.acquired_on') || 'T09:00')
WHERE entity='asset' AND data_json IS NOT NULL;
CREATE INDEX idx_items_acquired_on ON items(acquired_on);
CREATE INDEX idx_items_purchase_entry_id ON items(purchase_entry_id);
CREATE INDEX idx_items_sale_entry_id ON items(sale_entry_id);
CREATE TRIGGER sync_items_insert AFTER INSERT ON items
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', NEW.id, json_object('name', NEW.name, 'category', NEW.category, 'acquisition', NEW.acquisition, 'acquired_on', NEW.acquired_on, 'acquired_at', NEW.acquired_at, 'cost', NEW.cost, 'currency', NEW.currency, 'purchase_entry_id', NEW.purchase_entry_id, 'disposal', NEW.disposal, 'disposed_on', NEW.disposed_on, 'sale_amount', NEW.sale_amount, 'sale_entry_id', NEW.sale_entry_id, 'image', NEW.image, 'notes', NEW.notes, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
CREATE TRIGGER sync_items_update AFTER UPDATE ON items
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', NEW.id, json_object('name', NEW.name, 'category', NEW.category, 'acquisition', NEW.acquisition, 'acquired_on', NEW.acquired_on, 'acquired_at', NEW.acquired_at, 'cost', NEW.cost, 'currency', NEW.currency, 'purchase_entry_id', NEW.purchase_entry_id, 'disposal', NEW.disposal, 'disposed_on', NEW.disposed_on, 'sale_amount', NEW.sale_amount, 'sale_entry_id', NEW.sale_entry_id, 'image', NEW.image, 'notes', NEW.notes, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
CREATE TRIGGER sync_items_delete AFTER DELETE ON items
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', OLD.id, NULL) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
