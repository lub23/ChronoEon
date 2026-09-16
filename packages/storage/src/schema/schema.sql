-- ChronoEon SQLite schema — single source of DDL truth (user_version 1).
-- Applied exactly once by the storage package's migration runner; the runner
-- then bumps PRAGMA user_version to 1. Append-only by design.

CREATE TABLE entries (
  id                    TEXT PRIMARY KEY,
  modality              TEXT NOT NULL CHECK (modality IN ('task','event','bill','idea')),
  title                 TEXT NOT NULL,
  title_zh              TEXT,
  note                  TEXT,
  body                  TEXT, -- historical v1 column; retired and dropped by migration step 3
  status                TEXT CHECK (status IN ('open','in-progress','done','cancelled') OR status IS NULL),
  done_at               TEXT,
  cancelled_at          TEXT,
  priority              TEXT CHECK (priority IN ('low','high') OR priority IS NULL),
  urgency               TEXT CHECK (urgency IN ('low','high') OR urgency IS NULL),
  location              TEXT,
  date                  TEXT NOT NULL,
  start_time            TEXT,
  end_time              TEXT,
  end_date              TEXT,
  all_day               INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0,1)),
  amount                REAL,
  currency              TEXT DEFAULT 'CNY',
  category              TEXT,
  payment               TEXT,
  calendar              TEXT,
  color                 TEXT,
  recurrence            TEXT CHECK (recurrence IN ('daily','weekly','monthly','yearly') OR recurrence IS NULL),
  recurring_days        TEXT,
  recurring_end         TEXT,
  recurrence_exceptions TEXT,
  recurrence_moves      TEXT,
  reminder              TEXT CHECK (reminder IN ('none','at-time','5min','15min','30min','1hour','2hour','12hour','1day','1week','day-9am','day-before-9am','day-before-5pm','week-before-9am') OR reminder IS NULL),
  created_at            TEXT NOT NULL,
  updated_at            TEXT
);

CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag      TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, tag)
);

CREATE TABLE timer_segments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   TEXT REFERENCES entries(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  paused_at  INTEGER,
  resumed_at INTEGER
);

CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  entry_id     TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  local_path   TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('image','file')),
  width        INTEGER,
  height       INTEGER,
  bytes        INTEGER,
  mime         TEXT,
  caption      TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  file_missing INTEGER NOT NULL DEFAULT 0 CHECK (file_missing IN (0,1)),
  created_at   TEXT NOT NULL
);

CREATE TABLE ai_conversations (
  id              TEXT PRIMARY KEY,
  provider_kind   TEXT NOT NULL CHECK (provider_kind IN ('openai-compatible','local-openai-compatible')),
  base_url        TEXT,
  model           TEXT,
  title           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  archived_at     TEXT,
  parent_entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL
);

CREATE TABLE ai_messages (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content           TEXT NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  created_at        TEXT NOT NULL,
  proposed_entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL
);

CREATE TABLE schema_meta (
  key              TEXT PRIMARY KEY,
  import_id        TEXT,
  last_imported_at TEXT
);

CREATE INDEX idx_entries_date ON entries(date, end_date);
CREATE INDEX idx_entries_modality ON entries(modality);
CREATE INDEX idx_entry_tags_tag ON entry_tags(tag);
CREATE INDEX idx_attachments_entry_id ON attachments(entry_id);
CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id);
CREATE INDEX idx_timer_segments_entry ON timer_segments(entry_id);

-- Search is substring-based (LIKE over title/title_zh/note/location plus
-- an entry_tags join). FTS5 was deliberately not used: the in-memory test backend's
-- wa-sqlite build does not include the fts5 module, and a second search
-- surface that behaves differently would drift from production.
