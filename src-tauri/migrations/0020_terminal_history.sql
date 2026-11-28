-- RAV-71: the built-in terminal (docs/specs/terminal.md §5.1, §5.3). Additive only (CONTRIBUTING, overhaul rule).
--
-- terminal_commands: every command line typed in a Raven session, never its output, kept per engagement so a new
-- session can preload this engagement's history. Sessions write no history file (SR-4); this table, inside the
-- encrypted vault, is the only record.
CREATE TABLE terminal_commands (
  id INTEGER PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX terminal_commands_engagement ON terminal_commands (engagement_id, id);

-- The engagement folder (GLOSSARY), chosen once when the engagement's first session opens and kept, so renaming
-- the engagement never moves where its tools wrote their files. Null until then.
ALTER TABLE engagements ADD COLUMN folder TEXT;
