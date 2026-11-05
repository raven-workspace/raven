-- Step 5: exam-sim AD set. NULL = automatic (open 88 and 389), 0 = not part of the set, 1 = part of it.

ALTER TABLE hosts ADD COLUMN ad_set INTEGER CHECK (ad_set IN (0, 1));
