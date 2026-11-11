-- Interface nudges the user dismissed: a host + subnet pair we should not suggest a tunnel for again.
CREATE TABLE interface_dismissals (
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  subnet TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (host_id, subnet)
);
CREATE INDEX idx_interface_dismissals_engagement ON interface_dismissals(engagement_id);
