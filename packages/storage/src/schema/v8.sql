-- SQLite v8: recent local deletes are recoverable until the next logical sync
-- snapshot. The payload is a complete entry/attachment snapshot so restoring a
-- row never depends on the file system still having the original photo.

CREATE TABLE deleted_entries (
  id          TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  deleted_at  TEXT NOT NULL
);

CREATE INDEX idx_deleted_entries_deleted_at ON deleted_entries(deleted_at);
