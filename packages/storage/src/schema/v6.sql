-- Migration step 6 (user_version 5 -> 6). Bill categories now carry income/
-- expense direction, so signed amount cells are no longer a second source of
-- truth. Keep the absolute magnitude and let the category determine display.

UPDATE entries
SET amount = abs(amount)
WHERE modality = 'bill'
  AND amount IS NOT NULL;
