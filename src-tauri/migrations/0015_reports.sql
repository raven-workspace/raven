-- Reports: one per engagement for now; each section holds a ProseMirror JSON document that references evidence by id.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL UNIQUE REFERENCES engagements(id) ON DELETE CASCADE,
  candidate_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', osid TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, exported_at INTEGER);
CREATE TABLE report_sections (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, target_key TEXT, position INTEGER NOT NULL,
  doc TEXT, meta TEXT NOT NULL DEFAULT '{}', draft_built_at INTEGER, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX report_sections_unique ON report_sections (report_id, kind, COALESCE(target_key, ''));
ALTER TABLE finding_files ADD COLUMN modified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finding_files ADD COLUMN original_url TEXT;
ALTER TABLE finding_files ADD COLUMN original_content TEXT;
