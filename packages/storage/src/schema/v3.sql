-- Migration step 3 (user_version 2 -> 3). Applied by the JS-side runner in
-- one transaction. The note/body split is retired in the UI (2026-08-24): the
-- composer now has a single note field. This step folds any long-form body
-- text into note (body text appended after note, since a body-less note is
-- also legal) and drops the column, so no body text is lost.

UPDATE entries
SET note = CASE
  WHEN note IS NULL OR TRIM(note) = '' THEN body
  WHEN body IS NULL OR TRIM(body) = '' THEN note
  ELSE note || char(10) || char(10) || body
END
WHERE body IS NOT NULL AND TRIM(body) <> '';

ALTER TABLE entries DROP COLUMN body;
