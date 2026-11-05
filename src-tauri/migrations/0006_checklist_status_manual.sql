-- Step 6: a status the user set by hand (1) is never changed by the domain admin cover; auto-tick and the cover write 0.

ALTER TABLE checklist_items ADD COLUMN status_manual INTEGER NOT NULL DEFAULT 0 CHECK (status_manual IN (0, 1));
