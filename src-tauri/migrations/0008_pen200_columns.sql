-- raven:foreign-keys-off
-- Step 7: board columns become the PEN-200 stages. SQLite cannot alter a CHECK, so hosts is rebuilt.
-- Runs with foreign_keys OFF (set by the runner before the shared transaction), so dropping
-- hosts does not cascade into its children; they keep pointing at "hosts" by name.

CREATE TABLE hosts_new (
  id                 TEXT PRIMARY KEY,
  engagement_id      TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  ip                 TEXT,
  os                 TEXT CHECK (os IN ('windows','linux','other')),
  board_column       TEXT NOT NULL DEFAULT 'information-gathering'
                     CHECK (board_column IN ('information-gathering','vulnerability-detection','initial-foothold','privilege-escalation','post-exploitation','reporting')),
  board_manual       INTEGER NOT NULL DEFAULT 0,
  access             TEXT NOT NULL DEFAULT 'none' CHECK (access IN ('none','user','root')),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  dual_homed         INTEGER NOT NULL DEFAULT 0,
  board_derived      TEXT,
  access_reviewed_at INTEGER,
  ad_set             INTEGER CHECK (ad_set IN (0, 1)),
  UNIQUE (engagement_id, ip)
);

INSERT INTO hosts_new (id, engagement_id, name, ip, os, board_column, board_manual, access, created_at, updated_at,
                       dual_homed, board_derived, access_reviewed_at, ad_set)
SELECT id, engagement_id, name, ip, os,
       CASE board_column
         WHEN 'enumerate' THEN 'information-gathering'
         WHEN 'foothold'  THEN 'vulnerability-detection'
         WHEN 'privesc'   THEN 'privilege-escalation'
         WHEN 'loot'      THEN 'post-exploitation'
         WHEN 'done'      THEN 'reporting'
       END,
       board_manual, access, created_at, updated_at,
       dual_homed, NULL, access_reviewed_at, ad_set
FROM hosts;

DROP TABLE hosts;
ALTER TABLE hosts_new RENAME TO hosts;
