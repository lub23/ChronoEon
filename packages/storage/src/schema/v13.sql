-- SQLite v13: item photos are ordered, and location/payment are explicit fields.
ALTER TABLE items ADD COLUMN location TEXT;
ALTER TABLE items ADD COLUMN payment TEXT;
ALTER TABLE items ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(images_json));

UPDATE items SET images_json = CASE
  WHEN image IS NULL THEN '[]'
  ELSE json_array(image)
END;
UPDATE items SET image = NULL;

DROP TRIGGER IF EXISTS sync_items_insert;
DROP TRIGGER IF EXISTS sync_items_update;
CREATE TRIGGER sync_items_insert AFTER INSERT ON items
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', NEW.id, json_object(
    'name', NEW.name, 'category', NEW.category, 'acquisition', NEW.acquisition,
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
    'name', NEW.name, 'category', NEW.category, 'acquisition', NEW.acquisition,
    'acquired_on', NEW.acquired_on, 'acquired_at', NEW.acquired_at, 'cost', NEW.cost,
    'currency', NEW.currency, 'location', NEW.location, 'payment', NEW.payment,
    'purchase_entry_id', NEW.purchase_entry_id, 'disposal', NEW.disposal,
    'disposed_on', NEW.disposed_on, 'sale_amount', NEW.sale_amount,
    'sale_entry_id', NEW.sale_entry_id, 'images_json', NEW.images_json,
    'notes', NEW.notes, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at
  )) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
