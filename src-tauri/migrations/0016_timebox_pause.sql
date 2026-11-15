-- Exam-sim timebox pause: total paused time so far, and when the current pause began (NULL = running).
ALTER TABLE engagements ADD COLUMN timebox_paused_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engagements ADD COLUMN timebox_paused_at INTEGER;
