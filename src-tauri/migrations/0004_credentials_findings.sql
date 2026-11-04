-- Step 4: credentials, usernames, access grants, attempts, findings, failed attempts, plus hosts.access_reviewed_at.

CREATE TABLE credentials (
  id             TEXT PRIMARY KEY,
  engagement_id  TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('password','hash','ticket','key','token','other')),
  username       TEXT NOT NULL DEFAULT '',
  domain         TEXT,
  secret         TEXT NOT NULL DEFAULT '',
  hash_type      TEXT,
  scope          TEXT NOT NULL DEFAULT 'domain' CHECK (scope IN ('domain','local','app')),
  local_host_id  TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  source_host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  source         TEXT,
  notes          TEXT,
  crack_status   TEXT CHECK (crack_status IN ('uncracked','cracked','uncrackable')),
  cracked_from   TEXT REFERENCES credentials(id) ON DELETE SET NULL,
  from_secret_id TEXT REFERENCES credentials(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX credentials_engagement ON credentials (engagement_id);

CREATE TABLE usernames (
  id             TEXT PRIMARY KEY,
  engagement_id  TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  username       TEXT NOT NULL,
  domain         TEXT,
  source_host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  source         TEXT,
  created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX usernames_unique ON usernames (engagement_id, lower(username), lower(ifnull(domain, '')));

CREATE TABLE access_grants (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  username_id   TEXT NOT NULL REFERENCES usernames(id) ON DELETE CASCADE,
  host_id       TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  level         TEXT NOT NULL CHECK (level IN ('user','admin','system')),
  via           TEXT NOT NULL,
  log_entry_id  TEXT REFERENCES log_entries(id) ON DELETE SET NULL,
  at            INTEGER NOT NULL
);
CREATE INDEX access_grants_engagement ON access_grants (engagement_id);

CREATE TABLE cred_attempts (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  cred_id       TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  username_id   TEXT REFERENCES usernames(id) ON DELETE CASCADE,
  host_id       TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  service       TEXT NOT NULL CHECK (service IN ('smb','winrm','rdp','mssql','ssh','ftp','ldap','wmi','vnc','nfs','http','kerberos','other')),
  port          INTEGER,
  result        TEXT NOT NULL CHECK (result IN ('admin','valid','failed','errored')),
  auth_mode     TEXT NOT NULL CHECK (auth_mode IN ('domain','local')),
  detail        TEXT,
  log_entry_id  TEXT REFERENCES log_entries(id) ON DELETE SET NULL,
  at            INTEGER NOT NULL
);
CREATE UNIQUE INDEX cred_attempts_unique ON cred_attempts (cred_id, ifnull(username_id, ''), host_id, service, auth_mode);
CREATE INDEX cred_attempts_engagement ON cred_attempts (engagement_id);

CREATE TABLE findings (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  severity      TEXT CHECK (severity IN ('critical','high','medium','low','info')),
  cvss_vector   TEXT,
  cvss_score    REAL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','reported')),
  description   TEXT NOT NULL DEFAULT '',
  impact        TEXT NOT NULL DEFAULT '',
  remediation   TEXT NOT NULL DEFAULT '',
  exploit_notes TEXT NOT NULL DEFAULT '',
  lessons       TEXT NOT NULL DEFAULT '',
  refs          TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX findings_engagement ON findings (engagement_id);

CREATE TABLE finding_hosts (
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  host_id    TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  PRIMARY KEY (finding_id, host_id)
);

CREATE TABLE finding_services (
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (finding_id, service_id)
);

CREATE TABLE finding_steps (
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  entry_id   TEXT NOT NULL REFERENCES log_entries(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  PRIMARY KEY (finding_id, entry_id)
);

CREATE TABLE finding_files (
  id         TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  language   TEXT,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE failed_attempts (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  host_id       TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  finding_id    TEXT REFERENCES findings(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  reason_kind   TEXT CHECK (reason_kind IN ('control','precondition','access','operator')),
  reason        TEXT NOT NULL,
  private       INTEGER NOT NULL,
  log_entry_id  TEXT REFERENCES log_entries(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX failed_attempts_engagement ON failed_attempts (engagement_id);

ALTER TABLE hosts ADD COLUMN access_reviewed_at INTEGER;
