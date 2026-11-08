CREATE TABLE tried_pairs (
  id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  username TEXT NOT NULL, domain TEXT, secret TEXT NOT NULL,
  secret_kind TEXT NOT NULL CHECK (secret_kind IN ('password','hash')),
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  service TEXT NOT NULL, auth_mode TEXT NOT NULL CHECK (auth_mode IN ('domain','local')),
  log_entry_id TEXT REFERENCES log_entries(id) ON DELETE SET NULL, at INTEGER NOT NULL);
CREATE UNIQUE INDEX tried_pairs_unique ON tried_pairs (engagement_id, lower(username), lower(ifnull(domain,'')), secret, host_id, service, auth_mode);
CREATE TABLE extractions (
  log_entry_id TEXT PRIMARY KEY REFERENCES log_entries(id) ON DELETE CASCADE,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,   -- JSON ExtractionSummary
  record TEXT NOT NULL,    -- JSON ExtractionRecord
  created_at INTEGER NOT NULL, undone_at INTEGER);
