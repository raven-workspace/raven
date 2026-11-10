// In-memory stand-in for src/lib/api.ts, swapped in by the audit-mode Vite plugin. Reads return the fixtures,
// writes mutate a private copy and return the resulting record. Reloading the page restores the fixtures.
import type { Api } from "../lib/api";
import type { ChecklistItem } from "../types/checklist";
import type { TriedPair } from "../types/credentials";
import type { ErrorCode } from "../types/errors";
import type { NvdRecord } from "../types/findings";
import { RavenError } from "../types/errors";
import type { ServiceVerdict } from "../types/hostFacts";
import type { Extraction, Progress } from "../types/log";
import { AUDIT_NOW, FIXTURES, FIXTURE_PROGRESS, type AuditFixtures } from "./fixtures";

export type { Api };

let db: AuditFixtures = structuredClone(FIXTURES);
let progress: Record<string, Progress> = structuredClone(FIXTURE_PROGRESS);
let seq = 0;

/** Restores the fixtures. Called once at module load; tests call it to undo their mutations. */
export function resetAuditState(): void {
  db = structuredClone(FIXTURES);
  progress = structuredClone(FIXTURE_PROGRESS);
  seq = 0;
}
resetAuditState();

const nid = (prefix: string) => `${prefix}-new-${++seq}`;
const now = () => AUDIT_NOW;
import type { FieldManualSnapshot } from "../engines/fieldManual/merge";
import { parseNote } from "../engines/manual";

const AUDIT_NOTE_SOURCES: [string, string][] = [
  ["03-Tools/Zz-Scanner.md", "---\nid: tool-zz-scanner\ntitle: Zz Scanner\ntype: tool\n---\n## Overview\nA synthetic scanner.\n\n**Table 1 \u2014 Flags**\n\n| Flag | Meaning |\n|---|---|\n| -a | all |\n\n### Tips\n"],
  ["04-Foundations/Zz-Protocol.md", "---\nid: fnd-zz-protocol\ntitle: Zz Protocol\ntype: foundation\n---\n## How it works\nSynthetic text.\n\n## Failure modes\n"],
  ["05-Reporting/Zz-Finding-Template.md", "---\nid: rep-zz-finding\ntitle: Zz Finding Template\ntype: reporting\n---\n## Structure\nSynthetic text.\n"],
];

/** A synthetic Field Manual snapshot: no cards, three invented Manual notes. */
const AUDIT_FIELD_MANUAL: FieldManualSnapshot = {
  importedAt: AUDIT_NOW,
  cards: [],
  overlay: {},
  added: [],
  playbook: [],
  toolkit: [],
  notes: AUDIT_NOTE_SOURCES.flatMap(([p, t]) => parseNote(p, t) ?? []),
  report: { cardsAdded: 0, cardsChanged: 0, cardsRemoved: 0, commandsAdded: 0, commandsChanged: 0, commandsRemovedKept: [], classified: [] },
};

const clone = <T>(v: T): T => structuredClone(v);

function find<T extends { id: string }>(rows: T[], id: string): T {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new RavenError("not_found", `No record ${id}`);
  return row;
}
function remove<T extends { id: string }>(rows: T[], id: string): null {
  const i = rows.findIndex((r) => r.id === id);
  if (i >= 0) rows.splice(i, 1);
  return null;
}
const unsupported = (what: string): never => {
  // "unsupported" is audit-only, so it is not in the real ErrorCode union.
  throw new RavenError("unsupported" as ErrorCode, `${what} is not available in audit mode`);
};

/** Create/update helper: merges `input` over the row, ignoring undefined so "absent keeps the current value" holds. */
function assign<T extends object>(row: T, input: object, extra: Partial<T> = {}): T {
  for (const [k, v] of Object.entries(input)) if (v !== undefined) (row as Record<string, unknown>)[k] = v;
  return Object.assign(row, extra);
}

function listChecklist(engagementId: string): ChecklistItem[] {
  const owners = new Set([engagementId, ...db.hosts.filter((h) => h.engagementId === engagementId).map((h) => h.id)]);
  return clone(db.checklist.filter((c) => owners.has(c.ownerId)));
}

/** The one CVE the audit fake knows; any other ID is `not_found`. */
const AUDIT_NVD_RECORD: NvdRecord = {
  cveId: "CVE-2021-44228",
  description:
    "Apache Log4j2 2.0-beta9 through 2.15.0 JNDI features used in configuration, log messages, and parameters do not protect against attacker controlled LDAP and other JNDI related endpoints.",
  vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
  score: 10,
  cwes: ["CWE-917", "CWE-502"],
  references: ["https://logging.apache.org/log4j/2.x/security.html", "https://www.exploit-db.com/exploits/50592"],
  published: "2021-12-10T10:15:09.143",
  lastModified: "2025-02-04T15:15:13.773",
};

const base = {
  vaultStatus: async () => ({ exists: true, unlocked: true }),
  vaultCreate: async () => null,
  vaultUnlock: async () => ({ migratedFrom: 0, migratedTo: 0, dailyBackup: null, dailyBackupError: null }),
  vaultLock: async () => null,

  settingsGet: async () => clone(db.settings),
  settingsUpdate: async (patch) => {
    // The key itself is never stored or returned here either: only whether one is set.
    const { nvdApiKey, ...rest } = patch;
    // Same rule as the backend: the tools folders are folders on Kali.
    for (const field of ["windowsToolsDir", "linuxToolsDir"] as const) {
      const v = rest[field]?.trim();
      if (v && (/^[A-Za-z]:[\\/]/.test(v) || v.includes("\\"))) {
        throw new RavenError("validation", "must be a folder on Kali, like ~/tools/windows", field);
      }
    }
    Object.assign(db.settings, rest);
    if (nvdApiKey !== undefined) db.settings.nvdKeySet = nvdApiKey.trim() !== "";
    return clone(db.settings);
  },
  nvdLookup: async (cveId) => {
    const id = cveId.trim().toUpperCase();
    if (!/^CVE-\d{4}-\d{4,}$/.test(id)) throw new RavenError("validation", "use a CVE ID like CVE-2021-44228", "cveId");
    if (!db.settings.nvdKeySet) throw new RavenError("no_key", "no NVD API key is set");
    if (id !== AUDIT_NVD_RECORD.cveId) throw new RavenError("not_found", "not found");
    return clone(AUDIT_NVD_RECORD);
  },

  backupNow: async () => unsupported("Backup"),
  backupsList: async () => clone(db.backups),
  importApply: async () => unsupported("Import"),
  fieldManualScan: async () => unsupported("Field-Manual scan"),
  fieldManualLatestMtime: async () => null,
  fieldManualSave: async () => null,
  fieldManualLoad: async () => clone(AUDIT_FIELD_MANUAL),
  openObsidian: async () => {},
  backupRestore: async () => unsupported("Restore"),
  backupRestoreLocked: async () => unsupported("Restore"),

  engagementsList: async () => clone(db.engagements),
  engagementGet: async (id: string) => clone(find(db.engagements, id)),
  engagementCreate: async (input) => {
    const e = assign(
      { id: nid("e"), client: null, subLabel: null, scopeCidrs: [], domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active" as const, createdAt: now(), updatedAt: now(), lastActivityAt: null, lastRanOn: null, msfHostId: null } as unknown as (typeof db.engagements)[number],
      input,
    );
    db.engagements.push(e);
    return clone(e);
  },
  engagementUpdate: async (id: string, input) => clone(assign(find(db.engagements, id), input, { updatedAt: now() })),
  engagementSetStatus: async (id: string, status) => clone(assign(find(db.engagements, id), { status }, { updatedAt: now() })),
  engagementSetMsfHost: async (engagementId: string, hostId: string | null) =>
    clone(assign(find(db.engagements, engagementId), { msfHostId: hostId }, { updatedAt: now() })),
  engagementDelete: async (id: string) => remove(db.engagements, id),

  hostsList: async (engagementId: string) => clone(db.hosts.filter((h) => h.engagementId === engagementId)),
  hostCreate: async (engagementId: string, input) => {
    const h = assign(
      { id: nid("h"), engagementId, ip: null, os: null, boardColumn: "information-gathering", boardManual: false, access: "none", createdAt: now(), updatedAt: now(), dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false } as unknown as (typeof db.hosts)[number],
      input,
    );
    h.adSetEffective = h.adSet === true;
    db.hosts.push(h);
    return clone(h);
  },
  hostUpdate: async (id: string, input) => {
    const h = assign(find(db.hosts, id), input, { updatedAt: now() });
    if (input.adSet !== undefined) h.adSetEffective = input.adSet === true;
    return clone(h);
  },
  hostMove: async (id: string, column) => clone(assign(find(db.hosts, id), {}, { boardColumn: column, boardManual: true, updatedAt: now() })),
  hostSyncBoard: async (hostId: string, derived) => {
    const h = find(db.hosts, hostId);
    if (!h.boardManual) h.boardColumn = derived;
    h.boardDerived = derived;
    return clone(h);
  },
  hostDelete: async (id: string) => {
    db.services = db.services.filter((x) => x.hostId !== id);
    db.vectors = db.vectors.filter((v) => v.hostId !== id);
    db.hostIdentity = db.hostIdentity.filter((i) => i.hostId !== id);
    db.ruledOut = db.ruledOut.filter((r) => r.hostId !== id);
    return remove(db.hosts, id);
  },

  servicesList: async (hostId: string) => clone(db.services.filter((s) => s.hostId === hostId)),
  servicesListEngagement: async (engagementId: string) => {
    const ids = new Set(db.hosts.filter((h) => h.engagementId === engagementId).map((h) => h.id));
    return clone(db.services.filter((s) => ids.has(s.hostId)));
  },
  servicesUpsertScan: async (hostId: string, ports) => {
    for (const p of ports) {
      const existing = db.services.find((s) => s.hostId === hostId && s.port === p.port && s.protocol === p.protocol);
      const guess = { state: p.state, nmapService: p.service || null, nmapVersion: p.version || null, updatedAt: now() };
      if (existing) Object.assign(existing, guess);
      else db.services.push({ id: nid("s"), hostId, port: p.port, protocol: p.protocol, confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: now(), ...guess });
    }
    return clone(db.services.filter((s) => s.hostId === hostId));
  },
  serviceCreate: async (hostId: string, input) => {
    const s = { id: nid("s"), hostId, port: input.port, protocol: input.protocol ?? "tcp", state: "open", nmapService: input.nmapService ?? null, nmapVersion: input.nmapVersion ?? null, confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: now(), updatedAt: now() };
    db.services.push(s);
    return clone(s);
  },
  serviceUpdate: async (id: string, input) => clone(assign(find(db.services, id), input, { updatedAt: now() })),
  serviceConfirm: async (id: string, input) =>
    clone(assign(find(db.services, id), {}, { confirmedProduct: input.product, confirmedVersion: input.version ?? null, confirmedEntryId: input.entryId ?? null, updatedAt: now() })),
  serviceUnconfirm: async (id: string) =>
    clone(assign(find(db.services, id), {}, { confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, updatedAt: now() })),
  serviceDelete: async (id: string) => {
    db.ruledOut = db.ruledOut.filter((r) => !(r.sourceKind === "service" && r.sourceId === id));
    return remove(db.services, id);
  },
  serviceSetVerdict: async (id: string, verdict: ServiceVerdict | null, reason?: string) => {
    const s = find(db.services, id);
    if (verdict === "dead_end" && !reason?.trim()) throw new RavenError("validation", "a dead end needs a reason");
    db.ruledOut = db.ruledOut.filter((r) => !(r.sourceKind === "service" && r.sourceId === id));
    if (verdict === "dead_end") {
      const host = find(db.hosts, s.hostId);
      const label = s.confirmedProduct ? `${s.confirmedProduct} ${s.confirmedVersion ?? ""}` : (s.nmapVersion ?? s.nmapService ?? "");
      db.ruledOut.push({
        id: nid("r"), engagementId: host.engagementId, hostId: s.hostId, text: `${s.port}/${s.protocol} ${label}`.trim(),
        reason: reason!.trim(), private: false, sourceKind: "service", sourceId: id, createdAt: now(),
      });
    }
    return clone(assign(s, {}, { verdict, updatedAt: now() }));
  },
  hostIdentityGet: async (hostId: string) => clone(db.hostIdentity.find((i) => i.hostId === hostId) ?? null),
  hostIdentitySet: async (input) => {
    // As the Rust command: trimmed username, privileges and groups trimmed and de-duplicated.
    const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
    const username = input.username.trim();
    if (!username) throw new RavenError("validation", "username must be 1-200 characters");
    const row = { ...input, username, privileges: clean(input.privileges), groups: clean(input.groups), updatedAt: now() };
    db.hostIdentity = [...db.hostIdentity.filter((i) => i.hostId !== input.hostId), row];
    return clone(row);
  },
  vectorsList: async (hostId: string) => clone(db.vectors.filter((v) => v.hostId === hostId)),
  vectorUpsert: async (hostId: string, input) => {
    if (input.status === "ruled_out") throw new RavenError("validation", "rule a vector out with a reason");
    const existing = db.vectors.find((v) => v.hostId === hostId && v.title === input.title.trim());
    if (existing) {
      if (input.source === "auto" && (existing.status === "ruled_out" || existing.source === "manual")) return clone(existing);
      // A manual re-add after a ruling-out reopens it and drops the linked ruled-out item.
      if (existing.status === "ruled_out") db.ruledOut = db.ruledOut.filter((r) => !(r.sourceKind === "vector" && r.sourceId === existing.id));
      return clone(assign(existing, {}, { status: input.status, source: input.source, updatedAt: now() }));
    }
    const v = { id: nid("pv"), hostId, title: input.title.trim(), status: input.status, source: input.source, createdAt: now(), updatedAt: now() };
    db.vectors.push(v);
    return clone(v);
  },
  vectorSetStatus: async (id: string, status, reason) => {
    const v = find(db.vectors, id);
    if (status === "ruled_out" && !reason?.trim()) throw new RavenError("validation", "a ruled-out vector needs a reason");
    db.ruledOut = db.ruledOut.filter((r) => !(r.sourceKind === "vector" && r.sourceId === id));
    if (status === "ruled_out") {
      const host = find(db.hosts, v.hostId);
      db.ruledOut.push({
        id: nid("r"), engagementId: host.engagementId, hostId: v.hostId, text: v.title, reason: reason!.trim(),
        private: false, sourceKind: "vector", sourceId: id, createdAt: now(),
      });
    }
    return clone(assign(v, {}, { status, source: "manual", updatedAt: now() }));
  },
  vectorDelete: async (id: string) => {
    db.ruledOut = db.ruledOut.filter((r) => !(r.sourceKind === "vector" && r.sourceId === id));
    return remove(db.vectors, id);
  },

  logList: async (engagementId: string) => clone(db.log.filter((e) => e.engagementId === engagementId)),
  logCreate: async (engagementId: string, input) => {
    const { attachment, at, ...rest } = input;
    const id = nid("l");
    let content = rest.content;
    if (attachment && (content.kind === "screenshot" || content.kind === "flag")) {
      const attId = nid("a");
      db.attachments.push({ id: attId, mime: attachment.mime, dataBase64: attachment.dataBase64 });
      content = { ...content, attachmentId: attId };
    }
    const e = { titleEdited: false, ...rest, kind: content.kind, content, id, engagementId, at: at ?? now(), createdAt: now(), updatedAt: now() };
    db.log.push(e);
    return clone(e);
  },
  logUpdate: async (id: string, input) => {
    const { at, ...rest } = input;
    delete rest.attachment; // ignored on update
    // As the Rust update: an omitted payload id keeps the stored one; a blank one clears it and its values.
    const clearPayload = typeof rest.payloadId === "string" && rest.payloadId.trim() === "";
    if (rest.payloadId === null) delete rest.payloadId;
    if (rest.payloadValues === null) delete rest.payloadValues;
    if (clearPayload) Object.assign(rest, { payloadId: null, payloadValues: null });
    return clone(assign(find(db.log, id), rest, { kind: rest.content.kind, ...(at != null ? { at } : {}), updatedAt: now() }));
  },
  logDelete: async (id: string) => remove(db.log, id),

  checklistList: async (engagementId: string) => listChecklist(engagementId),
  checklistPut: async (engagementId: string, items) => {
    for (const it of items) {
      const base: ChecklistItem = { notes: null, completedAt: null, auto: false, autoFrom: null, evidence: [], ...it, updatedAt: now() };
      const i = db.checklist.findIndex((c) => c.ownerId === it.ownerId && c.goalId === it.goalId);
      if (i >= 0) db.checklist[i] = base;
      else db.checklist.push(base);
    }
    return listChecklist(engagementId);
  },
  // The cover and fact ticks are derived by engines the fake does not reimplement: the fixtures already carry their result.
  checklistApplyCover: async (engagementId: string) => listChecklist(engagementId),
  checklistApplyFacts: async (engagementId: string) => listChecklist(engagementId),

  notesGet: async (engagementId: string, hostId: string | null) => {
    const ownerId = hostId ?? engagementId;
    const n = db.notes.find((x) => x.ownerId === ownerId);
    return clone(n ?? { ownerId, engagementId, hostId, body: "", private: false, updatedAt: 0 });
  },
  notesList: async (engagementId: string) => clone(db.notes.filter((n) => n.engagementId === engagementId)),
  noteSave: async (engagementId: string, hostId: string | null, body: string, isPrivate: boolean) => {
    const ownerId = hostId ?? engagementId;
    let n = db.notes.find((x) => x.ownerId === ownerId);
    if (!n) db.notes.push((n = { ownerId, engagementId, hostId, body, private: isPrivate, updatedAt: now() }));
    Object.assign(n, { body, private: isPrivate, updatedAt: now() });
    return clone(n);
  },
  ruledOutList: async (engagementId: string) => clone(db.ruledOut.filter((r) => r.engagementId === engagementId)),
  ruledOutCreate: async (input) => {
    const r = { id: nid("r"), hostId: null, private: false, sourceKind: null, sourceId: null, ...input, createdAt: now() };
    db.ruledOut.push(r);
    return clone(r);
  },
  ruledOutDelete: async (id: string) => remove(db.ruledOut, id),

  tunnelsList: async (engagementId: string) => clone(db.tunnels.filter((t) => t.engagementId === engagementId)),
  tunnelCreate: async (engagementId: string, input) => {
    const t = { subnets: [], callbackIp: "", notes: null, ...input, id: nid("t"), engagementId, createdAt: now(), updatedAt: now() };
    db.tunnels.push(t);
    return clone(t);
  },
  tunnelUpdate: async (id: string, input) => clone(assign(find(db.tunnels, id), input, { updatedAt: now() })),
  tunnelDelete: async (id: string) => remove(db.tunnels, id),
  hopsList: async (engagementId: string) => clone(db.hops.filter((h) => h.engagementId === engagementId)),
  hopCreate: async (engagementId: string, input) => {
    const h = { fromHostId: null, logEntryId: null, ...input, id: nid("hp"), engagementId, at: input.at ?? now(), updatedAt: now() };
    db.hops.push(h);
    return clone(h);
  },
  hopUpdate: async (id: string, input) => clone(assign(find(db.hops, id), input, { updatedAt: now() })),
  hopDelete: async (id: string) => remove(db.hops, id),
  hostMarkAccessReviewed: async (hostId: string) => clone(assign(find(db.hosts, hostId), {}, { accessReviewedAt: now() })),

  credentialsList: async (engagementId: string) => clone(db.credentials.filter((c) => c.engagementId === engagementId)),
  credentialCreate: async (engagementId: string, input) => {
    const c = {
      username: "", domain: null, secret: "", hashType: null, scope: "domain" as const, localHostId: null, sourceHostId: null, source: null, notes: null,
      crackStatus: input.type === "hash" ? ("uncracked" as const) : null, crackedFrom: null, fromSecretId: null,
      ...input, id: nid("c"), engagementId, createdAt: now(), updatedAt: now(),
    };
    db.credentials.push(c);
    return clone(c);
  },
  credentialUpdate: async (id: string, input) => clone(assign(find(db.credentials, id), input, { updatedAt: now() })),
  credentialDelete: async (id: string) => remove(db.credentials, id),
  credentialCrack: async (hashId: string, plaintext: string) => {
    const hash = assign(find(db.credentials, hashId), {}, { crackStatus: "cracked", updatedAt: now() });
    const c = { ...hash, id: nid("c"), type: "password" as const, secret: plaintext, hashType: null, crackStatus: null, crackedFrom: null, fromSecretId: hash.id, createdAt: now(), updatedAt: now() };
    db.credentials.push(c);
    return clone(c);
  },
  credentialSetCrackStatus: async (id: string, status) => clone(assign(find(db.credentials, id), {}, { crackStatus: status, updatedAt: now() })),
  credentialConvertToAccess: async (credId: string, grant) => {
    const c = find(db.credentials, credId);
    let u = db.usernames.find((x) => x.engagementId === c.engagementId && x.username === c.username && x.domain === c.domain);
    if (!u) db.usernames.push((u = { id: nid("u"), engagementId: c.engagementId, username: c.username, domain: c.domain, sourceHostId: c.sourceHostId, source: c.source, createdAt: now() }));
    db.accessGrants.push({ id: nid("ag"), engagementId: c.engagementId, usernameId: u.id, hostId: grant.hostId, level: grant.level, via: grant.via, logEntryId: grant.logEntryId ?? null, at: grant.at ?? now() });
    return clone(u);
  },
  usernamesList: async (engagementId: string) => clone(db.usernames.filter((u) => u.engagementId === engagementId)),
  usernameCreate: async (engagementId: string, input) => {
    const u = { domain: null, sourceHostId: null, source: null, ...input, id: nid("u"), engagementId, createdAt: now() };
    db.usernames.push(u);
    return clone(u);
  },
  usernameDelete: async (id: string) => remove(db.usernames, id),
  credAttemptsList: async (engagementId: string) => clone(db.credAttempts.filter((a) => a.engagementId === engagementId)),
  credAttemptsUpsert: async (engagementId: string, inputs) => {
    for (const i of inputs) {
      const existing = db.credAttempts.find((a) => a.engagementId === engagementId && a.credId === i.credId && a.hostId === i.hostId && a.service === i.service && a.usernameId === (i.usernameId ?? null));
      const rank = { errored: 0, failed: 1, valid: 2, admin: 3 } as const;
      if (existing) {
        if (rank[i.result] >= rank[existing.result]) Object.assign(existing, { result: i.result, detail: i.detail ?? existing.detail, at: i.at ?? now() });
      } else {
        db.credAttempts.push({ usernameId: null, port: null, authMode: "domain", detail: null, logEntryId: null, ...i, id: nid("ca"), engagementId, at: i.at ?? now() } as (typeof db.credAttempts)[number]);
      }
    }
    return clone(db.credAttempts.filter((a) => a.engagementId === engagementId));
  },
  credAttemptDelete: async (id: string) => remove(db.credAttempts, id),
  payloadBuildsList: async (engagementId: string) => clone(db.payloadBuilds.filter((b) => b.engagementId === engagementId)),
  payloadBuildRecord: async (input) => {
    if (!input.payloadId.trim()) throw new RavenError("validation", "payload id is required", "payloadId");
    const host = db.hosts.find((h) => h.id === input.hostId && h.engagementId === input.engagementId);
    if (!host) throw new RavenError("not_found", "Not found");
    db.payloadBuilds = db.payloadBuilds.filter((b) => !(b.hostId === input.hostId && b.payloadId === input.payloadId));
    db.payloadBuilds.push(clone(input));
    return clone(input);
  },
  triedPairsList: async (engagementId: string) => clone(db.triedPairs.filter((t) => t.engagementId === engagementId)),
  triedPairsUpsert: async (engagementId: string, inputs) => {
    const out: TriedPair[] = [];
    for (const i of inputs) {
      const authMode = i.authMode ?? "domain";
      const same = (t: TriedPair) =>
        t.engagementId === engagementId && t.username.toLowerCase() === i.username.toLowerCase() && (t.domain ?? "").toLowerCase() === (i.domain ?? "").toLowerCase() &&
        t.secret === i.secret && t.hostId === i.hostId && t.service === i.service && t.authMode === authMode;
      let row = db.triedPairs.find(same);
      if (!row) {
        row = { id: nid("tp"), engagementId, username: i.username, domain: i.domain ?? null, secret: i.secret, secretKind: i.secretKind, hostId: i.hostId, service: i.service, authMode, logEntryId: i.logEntryId ?? null, at: i.at ?? now() };
        db.triedPairs.push(row);
      }
      out.push(clone(row));
    }
    return out;
  },
  triedPairDelete: async (id: string) => remove(db.triedPairs, id),
  triedPairPromote: async (engagementId: string, username: string, domain: string | null, secret: string) => {
    const hit = (t: TriedPair) =>
      t.engagementId === engagementId && t.username.toLowerCase() === username.toLowerCase() && (t.domain ?? "").toLowerCase() === (domain ?? "").toLowerCase() && t.secret === secret;
    const n = db.triedPairs.filter(hit).length;
    db.triedPairs = db.triedPairs.filter((t) => !hit(t));
    return n;
  },
  extractionSave: async (logEntryId, engagementId, summary, record) => {
    const row: Extraction = { logEntryId, engagementId, summary: clone(summary), record: clone(record), createdAt: now(), undoneAt: null };
    db.extractions = db.extractions.filter((x) => x.logEntryId !== logEntryId);
    db.extractions.push(row);
    return clone(row);
  },
  extractionGet: async (logEntryId: string) => clone(db.extractions.find((x) => x.logEntryId === logEntryId) ?? null),
  extractionsList: async (engagementId: string) => clone(db.extractions.filter((x) => x.engagementId === engagementId)),
  extractionUndo: async (logEntryId: string) => {
    const row = db.extractions.find((e) => e.logEntryId === logEntryId);
    if (!row) throw new RavenError("not_found", `No extraction for ${logEntryId}`);
    const r = row.record;
    // Reverse what the save filed: drop what it created, put back what it changed.
    db.credentials = db.credentials.filter((c) => !r.createdCredentialIds.includes(c.id));
    for (const before of r.credentialsBefore) {
      const i = db.credentials.findIndex((c) => c.id === before.id);
      if (i >= 0) db.credentials[i] = clone(before);
    }
    db.usernames = db.usernames.filter((u) => !r.createdUsernameIds.includes(u.id));
    db.credAttempts = db.credAttempts.filter((a) => !r.createdAttemptIds.includes(a.id));
    for (const before of r.attemptsBefore) {
      const i = db.credAttempts.findIndex((a) => a.id === before.id);
      if (i >= 0) db.credAttempts[i] = clone(before);
    }
    db.triedPairs = db.triedPairs.filter((t) => !r.createdTriedPairIds.includes(t.id));
    db.vectors = db.vectors.filter((v) => !r.createdVectorIds.includes(v.id));
    db.services = db.services.filter((s) => !r.createdServiceIds.includes(s.id));
    db.hosts = db.hosts.filter((h) => !r.createdHostIds.includes(h.id));
    row.undoneAt = now();
    return clone(row);
  },
  credAttemptsRekey: async (usernameId: string, secretCredIds: string[], credId: string, hostId?: string | null) => {
    const moved = db.credAttempts.filter((a) => a.usernameId === usernameId && secretCredIds.includes(a.credId) && (hostId == null || a.hostId === hostId));
    for (const a of moved) Object.assign(a, { credId, usernameId: null });
    return clone(moved);
  },
  accessGrantsList: async (engagementId: string) => clone(db.accessGrants.filter((g) => g.engagementId === engagementId)),
  accessGrantCreate: async (engagementId: string, input) => {
    const g = { logEntryId: null, ...input, usernameId: input.usernameId ?? "", id: nid("ag"), engagementId, at: input.at ?? now() };
    db.accessGrants.push(g);
    return clone(g);
  },
  accessGrantDelete: async (id: string) => remove(db.accessGrants, id),

  findingsList: async (engagementId: string) => clone(db.findings.filter((f) => f.engagementId === engagementId)),
  findingCreate: async (engagementId: string, input) => {
    const f = {
      severity: null, cvssVector: null, cvssScore: null, status: "draft" as const, description: "", impact: "", remediation: "", exploitNotes: "",
      lessons: "", refs: [], hostIds: [], serviceIds: [], stepEntryIds: [], ...input, id: nid("f"), engagementId, createdAt: now(), updatedAt: now(),
    };
    db.findings.push(f);
    return clone(f);
  },
  findingUpdate: async (id: string, input) => clone(assign(find(db.findings, id), input, { updatedAt: now() })),
  findingDelete: async (id: string) => remove(db.findings, id),
  findingFilesList: async (findingId: string) => clone(db.findingFiles.filter((f) => f.findingId === findingId)),
  findingFileCreate: async (findingId: string, input) => {
    const f = { language: null, ...input, id: nid("ff"), findingId, createdAt: now(), updatedAt: now() };
    db.findingFiles.push(f);
    return clone(f);
  },
  findingFileUpdate: async (id: string, input) => clone(assign(find(db.findingFiles, id), input, { updatedAt: now() })),
  findingFileDelete: async (id: string) => remove(db.findingFiles, id),
  failedAttemptsList: async (engagementId: string) => clone(db.failedAttempts.filter((f) => f.engagementId === engagementId)),
  failedAttemptCreate: async (engagementId: string, input) => {
    const f = { hostId: null, findingId: null, logEntryId: null, ...input, id: nid("fa"), engagementId, private: input.reasonKind === "operator", createdAt: now(), updatedAt: now() };
    db.failedAttempts.push(f);
    return clone(f);
  },
  failedAttemptUpdate: async (id: string, input) =>
    clone(assign(find(db.failedAttempts, id), input, { private: input.reasonKind === "operator", updatedAt: now() })),
  failedAttemptDelete: async (id: string) => remove(db.failedAttempts, id),

  attachmentGet: async (id: string) => clone(find(db.attachments, id)),

  cleanupList: async (engagementId: string) => clone(db.cleanup.filter((c) => c.engagementId === engagementId)),
  cleanupCreate: async (engagementId: string, input) => {
    const c = { hostId: null, notes: null, sourceEntryId: null, suggestionKey: null, ...input, id: nid("cl"), engagementId, status: "open" as const, removedAt: null, createdAt: now(), updatedAt: now() };
    db.cleanup.push(c);
    return clone(c);
  },
  cleanupUpdate: async (id: string, input) => {
    const rest = { ...input };
    delete rest.suggestionKey; // used on create only
    return clone(assign(find(db.cleanup, id), rest, { updatedAt: now() }));
  },
  cleanupSetRemoved: async (id: string, removed: boolean) =>
    clone(assign(find(db.cleanup, id), {}, { status: removed ? "removed" : "open", removedAt: removed ? now() : null, updatedAt: now() })),
  cleanupDismiss: async (engagementId: string, suggestionKey: string) => {
    db.cleanup.push({ id: nid("cl"), engagementId, hostId: null, kind: "other", target: suggestionKey, notes: null, sourceEntryId: null, suggestionKey, status: "dismissed", removedAt: null, createdAt: now(), updatedAt: now() });
    return null;
  },
  cleanupDelete: async (id: string) => remove(db.cleanup, id),
  cleanupCounts: async () => {
    const counts: Record<string, number> = {};
    for (const c of db.cleanup) if (c.status === "open") counts[c.engagementId] = (counts[c.engagementId] ?? 0) + 1;
    return counts;
  },
  engagementsProgress: async () => clone(progress),
} satisfies Api;

export type AuditScenario = "full" | "empty" | "loading" | "error";

export function scenarioFromSearch(search: string): AuditScenario {
  const v = new URLSearchParams(search).get("audit");
  return v === "empty" || v === "loading" || v === "error" ? v : "full";
}

let scenario: AuditScenario = "full";

/** Test/audit seam: picks the data state the fake serves, and restores the fixtures. */
export function setAuditScenario(s: AuditScenario): void {
  scenario = s;
  resetAuditState();
}

// These stay real in every scenario so the shell and routes still resolve.
const ALWAYS_REAL = new Set<string>(["vaultStatus", "settingsGet", "engagementsList", "engagementGet"]);
const LISTS = /List(Engagement)?$/;
const COUNT_MAPS = new Set<string>(["engagementsProgress", "cleanupCounts"]);

function forScenario(name: string, fn: (...a: never[]) => Promise<unknown>): (...a: never[]) => Promise<unknown> {
  if (ALWAYS_REAL.has(name)) {
    if (name === "engagementsList") return async () => (scenario === "empty" ? [clone(find(db.engagements, "e-lab"))] : fn());
    return fn;
  }
  return (...a) => {
    if (scenario === "loading") return new Promise<never>(() => {});
    if (scenario === "error") return Promise.reject(new RavenError("io", "Audit: simulated failure"));
    if (scenario === "empty") {
      if (LISTS.test(name)) return Promise.resolve([]);
      if (COUNT_MAPS.has(name)) return Promise.resolve({});
    }
    return fn(...a);
  };
}

const api = Object.fromEntries(
  Object.entries(base).map(([name, fn]) => [name, forScenario(name, fn as (...a: never[]) => Promise<unknown>)]),
) as unknown as typeof base;

setAuditScenario(scenarioFromSearch(typeof window === "undefined" ? "" : window.location.search));

export { api };
