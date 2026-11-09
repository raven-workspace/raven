-- Which baked payload (served script, msfvenom file, uploaded shell) was last built for a host, and with what LHOST/LPORT.
-- No payload text. One row per host and payload: a rebuild replaces it.
CREATE TABLE payload_builds (
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  payload_id TEXT NOT NULL, lhost TEXT NOT NULL, lport TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (host_id, payload_id));
CREATE INDEX payload_builds_engagement ON payload_builds (engagement_id);
