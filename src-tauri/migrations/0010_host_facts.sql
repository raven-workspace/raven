-- Host page redesign: service verdicts, host identity, privesc vectors, ruled-out source links, NVD cache.
ALTER TABLE services ADD COLUMN verdict TEXT CHECK (verdict IN ('candidate','untested','dead_end'));
ALTER TABLE ruled_out ADD COLUMN source_kind TEXT CHECK (source_kind IN ('service','vector'));
ALTER TABLE ruled_out ADD COLUMN source_id TEXT;

CREATE TABLE host_identity (
  host_id    TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  username   TEXT NOT NULL,
  privileges TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  groups     TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  entry_id   TEXT REFERENCES log_entries(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE privesc_vectors (
  id         TEXT PRIMARY KEY,
  host_id    TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('try','untested','ruled_out')),
  source     TEXT NOT NULL CHECK (source IN ('auto','manual')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (host_id, title)
);

CREATE TABLE nvd_cache (
  cve_id     TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  json       TEXT NOT NULL
);
