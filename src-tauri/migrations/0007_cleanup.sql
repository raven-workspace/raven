-- Step 6: per-engagement cleanup list (artifacts left on targets). 'dismissed' rows only hide suggestions.

CREATE TABLE cleanup_items (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('file','account','service','other')),
  target TEXT NOT NULL,
  notes TEXT,
  source_entry_id TEXT REFERENCES log_entries(id) ON DELETE SET NULL,
  suggestion_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','removed','dismissed')),
  removed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (engagement_id, suggestion_key)
);

CREATE INDEX idx_cleanup_items_engagement ON cleanup_items(engagement_id);
