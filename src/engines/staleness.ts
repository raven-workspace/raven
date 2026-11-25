/**
 * The staleness map: what a store change makes out of date, cascades included. It knows entities, never query keys:
 * each feature says which entities its queries read (`registerReads` in `src/lib/storeChange.ts`).
 *
 * Two parts. `FOREIGN_KEYS` mirrors the schema's foreign keys, so a delete follows the same cascades the store does
 * (a test reads `src-tauri/migrations/` and fails when this list drifts). `ALSO_WRITES` holds what a write does beyond
 * its own row and those cascades: rows the store changes by rule (a dead end's ruled-out item, a host delete's
 * checklist rows) and the follow-up writes the same write runs (checklist ticks, the Metasploit lock, board columns).
 */

/** The kinds of thing the vault holds. A link table (a log entry's hosts) is part of the entity it belongs to. */
export type Entity =
  | "engagement"
  | "host"
  | "service"
  | "logEntry"
  | "attachment"
  | "extraction"
  | "checklistItem"
  | "note"
  | "ruledOut"
  | "tunnel"
  | "hop"
  | "interfaceDismissal"
  | "credential"
  | "username"
  | "accessGrant"
  | "credAttempt"
  | "triedPair"
  | "finding"
  | "findingFile"
  | "failedAttempt"
  | "cleanupItem"
  | "hostIdentity"
  | "vector"
  | "payloadBuild"
  | "report"
  | "reportSection";

/**
 * What a write did. Most writes create, update or delete one row; a few have their own word because they do more:
 * a capture save files what the entry proves (`logEntry saved`), an undo reverses that (`extraction undone`), an
 * engagement form save syncs its scope (`engagement saved`), a crack stores a password (`credential cracked`) and a
 * conversion turns a credential into a username and a grant (`credential converted`).
 */
export type Change = "created" | "updated" | "deleted" | "saved" | "undone" | "cracked" | "converted";

/** One write, in entity terms: "host h1 deleted", "entry e5 saved". */
export interface StoreChange {
  entity: Entity;
  /** The row the write touched. A write over many rows of one engagement (a checklist batch) names the engagement. */
  id: string;
  change: Change;
}

/** Each entity's own table first, then the link tables that are part of it. */
export const ENTITY_TABLES: Record<Entity, readonly string[]> = {
  engagement: ["engagements"],
  host: ["hosts"],
  service: ["services"],
  logEntry: ["log_entries", "log_entry_hosts"],
  attachment: ["attachments"],
  extraction: ["extractions"],
  checklistItem: ["checklist_items"],
  note: ["notes"],
  ruledOut: ["ruled_out"],
  tunnel: ["tunnels"],
  hop: ["hops"],
  interfaceDismissal: ["interface_dismissals"],
  credential: ["credentials"],
  username: ["usernames"],
  accessGrant: ["access_grants"],
  credAttempt: ["cred_attempts"],
  triedPair: ["tried_pairs"],
  finding: ["findings", "finding_hosts", "finding_services", "finding_steps"],
  findingFile: ["finding_files"],
  failedAttempt: ["failed_attempts"],
  cleanupItem: ["cleanup_items"],
  hostIdentity: ["host_identity"],
  vector: ["privesc_vectors"],
  payloadBuild: ["payload_builds"],
  report: ["reports"],
  reportSection: ["report_sections"],
};

export type OnDelete = "cascade" | "set null";

/** `table.column REFERENCES references(id) ON DELETE onDelete`. */
export interface ForeignKey {
  table: string;
  column: string;
  references: string;
  onDelete: OnDelete;
}

const fk = (table: string, column: string, references: string, onDelete: OnDelete): ForeignKey => ({ table, column, references, onDelete });

/** The schema's foreign keys as the migrations leave them, table by table. */
export const FOREIGN_KEYS: readonly ForeignKey[] = [
  fk("engagements", "msf_host_id", "hosts", "set null"),
  fk("hosts", "engagement_id", "engagements", "cascade"),
  fk("services", "host_id", "hosts", "cascade"),
  fk("services", "confirmed_entry_id", "log_entries", "set null"),
  fk("log_entries", "engagement_id", "engagements", "cascade"),
  fk("log_entry_hosts", "entry_id", "log_entries", "cascade"),
  fk("log_entry_hosts", "host_id", "hosts", "cascade"),
  fk("attachments", "engagement_id", "engagements", "cascade"),
  fk("attachments", "entry_id", "log_entries", "cascade"),
  fk("extractions", "log_entry_id", "log_entries", "cascade"),
  fk("extractions", "engagement_id", "engagements", "cascade"),
  fk("checklist_items", "engagement_id", "engagements", "cascade"),
  fk("notes", "engagement_id", "engagements", "cascade"),
  fk("notes", "host_id", "hosts", "cascade"),
  fk("ruled_out", "engagement_id", "engagements", "cascade"),
  fk("ruled_out", "host_id", "hosts", "cascade"),
  fk("tunnels", "engagement_id", "engagements", "cascade"),
  fk("tunnels", "via_host_id", "hosts", "cascade"),
  fk("hops", "engagement_id", "engagements", "cascade"),
  fk("hops", "from_host_id", "hosts", "cascade"),
  fk("hops", "to_host_id", "hosts", "cascade"),
  fk("hops", "log_entry_id", "log_entries", "set null"),
  fk("interface_dismissals", "engagement_id", "engagements", "cascade"),
  fk("interface_dismissals", "host_id", "hosts", "cascade"),
  fk("credentials", "engagement_id", "engagements", "cascade"),
  fk("credentials", "local_host_id", "hosts", "set null"),
  fk("credentials", "source_host_id", "hosts", "set null"),
  fk("credentials", "cracked_from", "credentials", "set null"),
  fk("credentials", "from_secret_id", "credentials", "set null"),
  fk("usernames", "engagement_id", "engagements", "cascade"),
  fk("usernames", "source_host_id", "hosts", "set null"),
  fk("access_grants", "engagement_id", "engagements", "cascade"),
  fk("access_grants", "username_id", "usernames", "cascade"),
  fk("access_grants", "host_id", "hosts", "cascade"),
  fk("access_grants", "log_entry_id", "log_entries", "set null"),
  fk("cred_attempts", "engagement_id", "engagements", "cascade"),
  fk("cred_attempts", "cred_id", "credentials", "cascade"),
  fk("cred_attempts", "username_id", "usernames", "cascade"),
  fk("cred_attempts", "host_id", "hosts", "cascade"),
  fk("cred_attempts", "log_entry_id", "log_entries", "set null"),
  fk("tried_pairs", "engagement_id", "engagements", "cascade"),
  fk("tried_pairs", "host_id", "hosts", "cascade"),
  fk("tried_pairs", "log_entry_id", "log_entries", "set null"),
  fk("findings", "engagement_id", "engagements", "cascade"),
  fk("finding_hosts", "finding_id", "findings", "cascade"),
  fk("finding_hosts", "host_id", "hosts", "cascade"),
  fk("finding_services", "finding_id", "findings", "cascade"),
  fk("finding_services", "service_id", "services", "cascade"),
  fk("finding_steps", "finding_id", "findings", "cascade"),
  fk("finding_steps", "entry_id", "log_entries", "cascade"),
  fk("finding_files", "finding_id", "findings", "cascade"),
  fk("failed_attempts", "engagement_id", "engagements", "cascade"),
  fk("failed_attempts", "host_id", "hosts", "set null"),
  fk("failed_attempts", "finding_id", "findings", "set null"),
  fk("failed_attempts", "log_entry_id", "log_entries", "set null"),
  fk("cleanup_items", "engagement_id", "engagements", "cascade"),
  fk("cleanup_items", "host_id", "hosts", "set null"),
  fk("cleanup_items", "source_entry_id", "log_entries", "set null"),
  fk("host_identity", "host_id", "hosts", "cascade"),
  fk("host_identity", "entry_id", "log_entries", "set null"),
  fk("privesc_vectors", "host_id", "hosts", "cascade"),
  fk("payload_builds", "engagement_id", "engagements", "cascade"),
  fk("payload_builds", "host_id", "hosts", "cascade"),
  fk("reports", "engagement_id", "engagements", "cascade"),
  fk("report_sections", "report_id", "reports", "cascade"),
];

type Also = readonly { entity: Entity; change: Change }[];

const to = (entity: Entity, ...changes: Change[]): Also => changes.map((change) => ({ entity, change }));

/** An entry's checklist follow-up: its ticks, the domain admin cover, the board columns and the Metasploit lock. */
const ENTRY_FOLLOW_UP: Also = [...to("checklistItem", "updated"), ...to("host", "updated"), ...to("engagement", "updated")];

/** What a write changes beyond its own row and the schema's cascades. */
export const ALSO_WRITES: Partial<Record<Entity, Partial<Record<Change, Also>>>> = {
  // Creating an engagement, or saving its form, adds a host for each new single-IP scope entry.
  engagement: { created: to("host", "created"), saved: to("host", "created") },
  // checklist_items.owner_id has no foreign key, so the store clears a deleted host's rows by hand.
  host: { deleted: to("checklistItem", "deleted") },
  // A dead-end verdict writes a ruled-out item linked to its source; undoing it or deleting the source removes it.
  service: { updated: to("ruledOut", "created", "deleted"), deleted: to("ruledOut", "deleted") },
  vector: { created: to("ruledOut", "deleted"), updated: to("ruledOut", "created", "deleted"), deleted: to("ruledOut", "deleted") },
  logEntry: {
    // An entry is the engagement's latest activity.
    created: to("engagement", "updated"),
    updated: ENTRY_FOLLOW_UP,
    deleted: ENTRY_FOLLOW_UP,
    // A capture save stores the entry, files what it proves and records that as its extraction, then follows up.
    saved: [
      ...to("logEntry", "created"),
      ...to("host", "created", "updated"),
      ...to("service", "created", "updated"),
      ...to("hostIdentity", "updated"),
      ...to("vector", "created"),
      ...to("credential", "created", "cracked"),
      ...to("username", "created"),
      ...to("credAttempt", "created", "updated"),
      ...to("triedPair", "created", "deleted"),
      ...to("extraction", "created"),
      ...ENTRY_FOLLOW_UP,
    ],
  },
  // Undo deletes or restores what the save filed (hosts, services, credentials, usernames, attempts, tried pairs,
  // vectors, identity), puts back the tried pairs the save promoted, then the entry's follow-up runs again.
  extraction: {
    undone: [
      ...to("extraction", "updated"),
      ...to("host", "deleted", "updated"),
      ...to("service", "deleted", "updated"),
      ...to("hostIdentity", "updated", "deleted"),
      ...to("vector", "deleted"),
      ...to("credential", "deleted", "updated"),
      ...to("username", "deleted"),
      ...to("credAttempt", "deleted", "updated"),
      ...to("triedPair", "deleted", "created"),
      ...ENTRY_FOLLOW_UP,
    ],
  },
  credential: {
    // A stored credential is the end of its tried pairs: promotion removes those matching it.
    created: to("triedPair", "deleted"),
    updated: to("triedPair", "deleted"),
    // A crack stores (or finds) the password and marks the hash cracked.
    cracked: [...to("credential", "created", "updated")],
    // A placeholder credential becomes a username with an access grant, and goes.
    converted: [...to("username", "created"), ...to("accessGrant", "created"), ...to("credential", "deleted")],
  },
};

const REFERENCED_BY = new Map<string, ForeignKey[]>();
for (const key of FOREIGN_KEYS) REFERENCED_BY.set(key.references, [...(REFERENCED_BY.get(key.references) ?? []), key]);

const ENTITY_OF_TABLE = new Map<string, Entity>(
  (Object.entries(ENTITY_TABLES) as [Entity, readonly string[]][]).flatMap(([entity, tables]) => tables.map((t) => [t, entity] as const)),
);

/** The entity a table belongs to. */
export function entityOfTable(table: string): Entity | undefined {
  return ENTITY_OF_TABLE.get(table);
}

/**
 * Every entity a store change leaves out of date: the entity itself, what the write also changes, and for a delete
 * everything the schema's foreign keys cascade to or clear.
 */
export function staleAfter(change: Pick<StoreChange, "entity" | "change">): ReadonlySet<Entity> {
  const stale = new Set<Entity>();
  const seen = new Set<string>();
  const rowsDeleted = (table: string) => {
    if (seen.has(`table:${table}`)) return;
    seen.add(`table:${table}`);
    for (const key of REFERENCED_BY.get(table) ?? []) {
      const child = ENTITY_OF_TABLE.get(key.table);
      if (!child) throw new Error(`staleness map: no entity for table ${key.table}`);
      if (key.onDelete === "set null") stale.add(child);
      else if (ENTITY_TABLES[child][0] === key.table) visit(child, "deleted");
      else {
        // Rows of a link table go: the entity they belong to changes, but is not deleted.
        stale.add(child);
        rowsDeleted(key.table);
      }
    }
  };
  const visit = (entity: Entity, what: Change) => {
    if (seen.has(`${entity}:${what}`)) return;
    seen.add(`${entity}:${what}`);
    stale.add(entity);
    for (const also of ALSO_WRITES[entity]?.[what] ?? []) visit(also.entity, also.change);
    if (what === "deleted") rowsDeleted(ENTITY_TABLES[entity][0]);
  };
  visit(change.entity, change.change);
  return stale;
}
