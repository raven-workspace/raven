CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE engagements (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK(kind IN ('exam-sim','lab','client')),
  client           TEXT,
  sub_label        TEXT,
  scope_cidrs      TEXT NOT NULL DEFAULT '[]',
  domain           TEXT,
  starts_at        INTEGER,
  ends_at          INTEGER,
  timebox_start    INTEGER,
  timebox_minutes  INTEGER,
  status           TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  last_activity_at INTEGER
);
