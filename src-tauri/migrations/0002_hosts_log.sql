-- Step 2: hosts, services, the engagement log, attachments. Everything hangs off engagements(id).

CREATE TABLE hosts (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  ip            TEXT,
  os            TEXT CHECK (os IN ('windows','linux','other')),
  board_column  TEXT NOT NULL DEFAULT 'enumerate'
                CHECK (board_column IN ('enumerate','foothold','privesc','loot','done')),
  board_manual  INTEGER NOT NULL DEFAULT 0,
  access        TEXT NOT NULL DEFAULT 'none' CHECK (access IN ('none','user','root')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (engagement_id, ip)
);

CREATE TABLE log_entries (
  id                TEXT PRIMARY KEY,
  engagement_id     TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('command','screenshot','http','note','flag')),
  title             TEXT NOT NULL,
  title_edited      INTEGER NOT NULL DEFAULT 0,
  ran_on            TEXT,
  observations      TEXT,
  returned_nothing  INTEGER NOT NULL DEFAULT 0,
  private           INTEGER NOT NULL DEFAULT 0,
  content           TEXT NOT NULL,
  at                INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX log_entries_engagement_at ON log_entries (engagement_id, at);

CREATE TABLE services (
  id                 TEXT PRIMARY KEY,
  host_id            TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  port               INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  protocol           TEXT NOT NULL DEFAULT 'tcp' CHECK (protocol IN ('tcp','udp')),
  state              TEXT NOT NULL DEFAULT 'open',
  nmap_service       TEXT,
  nmap_version       TEXT,
  confirmed_product  TEXT,
  confirmed_version  TEXT,
  confirmed_entry_id TEXT REFERENCES log_entries(id) ON DELETE SET NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  UNIQUE (host_id, port, protocol)
);

CREATE TABLE log_entry_hosts (
  entry_id TEXT NOT NULL REFERENCES log_entries(id) ON DELETE CASCADE,
  host_id  TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, host_id)
);

CREATE TABLE attachments (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  entry_id      TEXT REFERENCES log_entries(id) ON DELETE CASCADE,
  mime          TEXT NOT NULL,
  bytes         BLOB NOT NULL,
  size          INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

ALTER TABLE engagements ADD COLUMN last_ran_on TEXT;
