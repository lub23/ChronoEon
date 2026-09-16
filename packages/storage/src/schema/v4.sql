-- Migration step 4 (user_version 3 -> 4). Separates model reasoning from the
-- user-facing assistant answer so hidden thinking can be disclosed on demand.
ALTER TABLE ai_messages ADD COLUMN reasoning_content TEXT;
