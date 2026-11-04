-- Step 3: checklist items, notes, ruled-out items, tunnels, hops, plus a few host/engagement columns.

CREATE TABLE checklist_items (
  owner_id      TEXT NOT NULL,  -- a host id, or the engagement id for engagement goals
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  goal_id       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('todo','in_progress','done','na')),
  notes         TEXT,
  completed_at  INTEGER,
  auto          INTEGER NOT NULL DEFAULT 0,
  auto_from     TEXT CHECK (auto_from IN ('na','in_progress')),
  evidence      TEXT NOT NULL DEFAULT '[]',
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (owner_id, goal_id)
);
CREATE INDEX checklist_items_engagement ON checklist_items (engagement_id);

CREATE TABLE notes (
  owner_id      TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  host_id       TEXT REFERENCES hosts(id) ON DELETE CASCADE,
  body          TEXT NOT NULL DEFAULT '',
  private       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE ruled_out (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  host_id       TEXT REFERENCES hosts(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  reason        TEXT NOT NULL,
  private       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE tunnels (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('ligolo','chisel','ssh','socks','other')),
  via_host_id   TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  subnets       TEXT NOT NULL DEFAULT '[]',
  callback_ip   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN ('up','down')),
  notes         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE hops (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  from_host_id  TEXT REFERENCES hosts(id) ON DELETE CASCADE,
  to_host_id    TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  via           TEXT NOT NULL,
  log_entry_id  TEXT REFERENCES log_entries(id) ON DELETE SET NULL,
  at            INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

ALTER TABLE hosts ADD COLUMN dual_homed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hosts ADD COLUMN board_derived TEXT;
ALTER TABLE engagements ADD COLUMN msf_host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL;
