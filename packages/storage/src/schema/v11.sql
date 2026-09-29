-- SQLite v11: owned assets are independent user data, not bill projections.
-- Bill IDs are soft references: deleting/replacing a ledger never deletes assets.
-- Cross-field lifecycle/link validation belongs to local saves, not constraints
-- that would reject otherwise valid concurrent sync projections.
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (category IN ('electronics','clothing','home','transport','hobby','other')),
  acquisition TEXT NOT NULL CHECK (acquisition IN ('purchase','gift','windfall')),
  acquired_on TEXT NOT NULL,
  cost REAL NOT NULL CHECK (cost >= 0),
  currency TEXT NOT NULL CHECK (length(trim(currency)) > 0),
  purchase_entry_id TEXT,
  disposal TEXT CHECK (disposal IS NULL OR disposal IN ('sold','lost','discarded')),
  disposed_on TEXT,
  sale_amount REAL CHECK (sale_amount IS NULL OR sale_amount >= 0),
  sale_entry_id TEXT,
  image TEXT CHECK (image IS NULL OR (length(image) = 81 AND substr(image,1,12) = 'attachments/' AND substr(image,-5) = '.webp' AND substr(image,13,64) NOT GLOB '*[^0-9a-f]*')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_assets_acquired_on ON assets(acquired_on);
CREATE INDEX idx_assets_purchase_entry_id ON assets(purchase_entry_id);
CREATE INDEX idx_assets_sale_entry_id ON assets(sale_entry_id);

CREATE TRIGGER sync_assets_insert AFTER INSERT ON assets
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', NEW.id, json_object('name', NEW.name, 'category', NEW.category, 'acquisition', NEW.acquisition, 'acquired_on', NEW.acquired_on, 'cost', NEW.cost, 'currency', NEW.currency, 'purchase_entry_id', NEW.purchase_entry_id, 'disposal', NEW.disposal, 'disposed_on', NEW.disposed_on, 'sale_amount', NEW.sale_amount, 'sale_entry_id', NEW.sale_entry_id, 'image', NEW.image, 'notes', NEW.notes, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
CREATE TRIGGER sync_assets_update AFTER UPDATE ON assets
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', NEW.id, json_object('name', NEW.name, 'category', NEW.category, 'acquisition', NEW.acquisition, 'acquired_on', NEW.acquired_on, 'cost', NEW.cost, 'currency', NEW.currency, 'purchase_entry_id', NEW.purchase_entry_id, 'disposal', NEW.disposal, 'disposed_on', NEW.disposed_on, 'sale_amount', NEW.sale_amount, 'sale_entry_id', NEW.sale_entry_id, 'image', NEW.image, 'notes', NEW.notes, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at)) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
CREATE TRIGGER sync_assets_delete AFTER DELETE ON assets
WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0
BEGIN
  INSERT INTO sync_changes(entity, entity_id, data_json) VALUES ('asset', OLD.id, NULL) ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json, changed_at=excluded.changed_at;
END;
