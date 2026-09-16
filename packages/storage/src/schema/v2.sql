-- Migration step 2 (user_version 1 -> 2). Applied by the JS-side runner in
-- one transaction. DROP TABLE timer_segments is a documented destructive step:
-- the table never shipped to any user (the SQLite path was dev-internal) and
-- it modeled a segment list that does not match the domain TimerSession shape.

ALTER TABLE attachments ADD COLUMN original_local_path TEXT;

CREATE TABLE timer_session (
  id           TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

DROP TABLE timer_segments;
