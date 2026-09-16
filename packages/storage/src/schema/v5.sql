-- Migration step 5 (user_version 4 -> 5). Ideas no longer carry scheduling
-- priority metadata; clear it without touching task/event/bill rows.

UPDATE entries
SET priority = NULL,
    urgency = NULL
WHERE modality = 'idea';
