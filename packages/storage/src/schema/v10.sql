-- SQLite v10: a parsed capture review survives the dialog. The drafts, the
-- edit flag and the saved flag stay on the device that parsed them: they are
-- transient UI state for one conversation, not shared user data, so the table
-- deliberately has no sync trigger and no entity in the sync schema.

CREATE TABLE ai_capture_reviews (
  conversation_id TEXT PRIMARY KEY REFERENCES ai_conversations(id) ON DELETE CASCADE,
  message_id      TEXT NOT NULL,
  source          TEXT NOT NULL,
  drafts_json     TEXT NOT NULL,
  edited          INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
  saved           INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
  updated_at      TEXT NOT NULL
);
