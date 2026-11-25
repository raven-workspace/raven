-- RAV-51: a username records its scope: a domain account, a local account on one host, or unknown. Every existing
-- username becomes unknown with no host, which keeps its identity exactly as it was; nothing is inferred from the data.
-- Additive: two new columns and the unique index replaced. No table rebuild, so foreign keys stay on.

ALTER TABLE usernames ADD COLUMN scope TEXT NOT NULL DEFAULT 'unknown' CHECK (scope IN ('domain','local','unknown'));
ALTER TABLE usernames ADD COLUMN local_host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL;

DROP INDEX usernames_unique;

-- Domain and unknown usernames: one per scope, name and domain as spelled. The store decides when two spellings of a
-- domain are one, so this only stops exact duplicates, as the old index did.
CREATE UNIQUE INDEX usernames_unique ON usernames (engagement_id, scope, lower(username), lower(ifnull(domain, '')))
  WHERE scope <> 'local';

-- Local usernames: one per name on each host. Deleting a host sets its local usernames' host to NULL, and NULLs never
-- collide, so local usernames left with no host stay.
CREATE UNIQUE INDEX usernames_local_unique ON usernames (engagement_id, local_host_id, lower(username))
  WHERE scope = 'local';
