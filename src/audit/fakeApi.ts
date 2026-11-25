// In-memory stand-in for src/lib/api.ts, swapped in by the audit-mode Vite plugin. Reads return the fixtures,
// writes mutate a private copy and return the resulting record. Reloading the page restores the fixtures.
// It must pass the same store scenarios as the real store (src/test/storeScenarios), and throw only the app's error codes.
import { credKey, stripLineBreaks } from "../engines/credentials/keys";
import type { CommandOverlay, FieldManualSnapshot } from "../engines/fieldManual/merge";
import { BUILTIN_LIBRARY } from "../engines/library/data";
import { FIELD_MANUAL_CARDS } from "../engines/library/data/fieldManual";
import { parseNote } from "../engines/manual";
import type { Api } from "../lib/api";
import type { ChecklistItem } from "../types/checklist";
import type { AttemptService, Credential, CredentialInput, TriedPair } from "../types/credentials";
import type { GoalRef } from "../engines/checklist";
import type { EngagementInput } from "../types/engagement";
import { BOARD_COLUMNS, type Host, type HostInput } from "../types/host";
import type { NvdRecord } from "../types/findings";
import { RavenError } from "../types/errors";
import type { Report, ReportSection } from "../types/report";
import type { ServiceVerdict } from "../types/hostFacts";
import type { Extraction, ExtractionProofs, ExtractionRecord, Filed, PlannedAttemptProof, Progress } from "../types/log";
import type { Service } from "../types/service";
import { AUDIT_NOTE_SOURCES, AUDIT_NOW, FIXTURES, FIXTURE_PROGRESS, type AuditFixtures } from "./fixtures";

export type { Api };

let db: AuditFixtures = structuredClone(FIXTURES);
let progress: Record<string, Progress> = structuredClone(FIXTURE_PROGRESS);
let seq = 0;

/**
 * Restores the fixtures, or starts from `seed` (`EMPTY_FIXTURES` for an empty store). Called once at module load;
 * tests call it to undo their mutations.
 */
export function resetAuditState(seed: AuditFixtures = FIXTURES): void {
  db = structuredClone(seed);
  progress = seed === FIXTURES ? structuredClone(FIXTURE_PROGRESS) : {};
  seq = 0;
}
resetAuditState();

const nid = (prefix: string) => `${prefix}-new-${++seq}`;
const now = () => AUDIT_NOW;

/**
 * What a real import stores: the built-in cards, every field-manual command overlaid as the vault has it (here unchanged,
 * so the library reads the same), the synthetic Manual notes, and a plausible report of a re-import.
 */
const AUDIT_FIELD_MANUAL: FieldManualSnapshot = {
  importedAt: AUDIT_NOW - 26 * 60 * 60_000,
  cards: FIELD_MANUAL_CARDS,
  overlay: Object.fromEntries(
    BUILTIN_LIBRARY.filter((c) => c.source === "field-manual").map((c): [string, CommandOverlay] => [
      c.id, c.why === undefined ? { title: c.title, template: c.template } : { title: c.title, template: c.template, why: c.why },
    ]),
  ),
  added: [],
  playbook: [],
  toolkit: [],
  notes: AUDIT_NOTE_SOURCES.flatMap(([p, t]) => parseNote(p, t) ?? []),
  report: { cardsAdded: 0, cardsChanged: 2, cardsRemoved: 0, commandsAdded: 0, commandsChanged: 5, commandsRemovedKept: [], classified: [] },
};

const clone = <T>(v: T): T => structuredClone(v);

type FakeHost = AuditFixtures["hosts"][number];
/**
 * A host as the store returns it: `adSetEffective` derived on every read, as `ad_effective_sql` does, so it follows the
 * switch and every service change. The switch if set, else 88 and 389 both in state exactly `open`.
 */
function hostOut(h: FakeHost): FakeHost {
  const open = (port: number) => db.services.some((s) => s.hostId === h.id && s.port === port && s.state === "open");
  return clone({ ...h, adSetEffective: h.adSet ?? (open(88) && open(389)) });
}

const notFound = () => new RavenError("not_found", "not found");
const invalid = (field: string, message: string) => new RavenError("validation", message, field);

function find<T extends { id: string }>(rows: T[], id: string): T {
  const row = rows.find((r) => r.id === id);
  if (!row) throw notFound();
  return row;
}
/** Deletes row `id`; `not_found` if there was none, as the store's `delete_by_id`. */
function remove<T extends { id: string }>(rows: T[], id: string): null {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) throw notFound();
  rows.splice(i, 1);
  return null;
}
/** The engagement must exist (db.rs `check_scope` with no host). */
function engagementMustExist(id: string): void {
  if (!db.engagements.some((e) => e.id === id)) throw notFound();
}
// What the desktop app does on disk can't happen in a browser. `io` is the code the app shows as a plain failure.
const unsupported = (what: string): never => {
  throw new RavenError("io", `${what} is not available in audit mode`);
};

const blank = (s: string | null | undefined): string | null => s?.trim() || null;

/** engagements.rs `valid_cidr`: dotted-quad IPv4 with an optional /0-32 prefix, no leading zeros. */
function validCidr(s: string): boolean {
  const slash = s.indexOf("/");
  if (slash >= 0) {
    const p = s.slice(slash + 1);
    if (!/^(0|[1-9][0-9]?)$/.test(p) || Number(p) > 32) return false;
  }
  const parts = (slash < 0 ? s : s.slice(0, slash)).split(".");
  return parts.length === 4 && parts.every((o) => /^(0|[1-9][0-9]{0,2})$/.test(o) && Number(o) <= 255);
}
/** hosts.rs `single_ip`: one IPv4 address, bare or `/32`, returned bare. */
function singleIp(s: string): string | null {
  const bare = s.endsWith("/32") ? s.slice(0, -3) : s;
  return !bare.includes("/") && validCidr(bare) ? bare : null;
}

/** engagements.rs `normalise`: every field is replaced, so an absent one is cleared. */
function cleanEngagement(i: EngagementInput) {
  const name = i.name.trim();
  if (!name || [...name].length > 120) throw invalid("name", "name must be 1-120 characters");
  if (!["exam-sim", "lab", "client"].includes(i.kind)) throw invalid("kind", "kind must be exam-sim, lab or client");
  const scopeCidrs = (i.scopeCidrs ?? []).map((c) => c.trim());
  const bad = scopeCidrs.find((c) => !validCidr(c));
  if (bad !== undefined) throw invalid("scopeCidrs", `invalid IPv4 CIDR: ${bad}`);
  const startsAt = i.startsAt ?? null;
  const endsAt = i.endsAt ?? null;
  if (startsAt !== null && endsAt !== null && endsAt < startsAt) throw invalid("endsAt", "end must not be before start");
  const exam = i.kind === "exam-sim";
  const timeboxMinutes = exam ? (i.timeboxMinutes ?? null) : null;
  if (timeboxMinutes !== null && !(timeboxMinutes >= 1 && timeboxMinutes <= 4320)) throw invalid("timeboxMinutes", "timebox must be 1-4320 minutes");
  return {
    name, kind: i.kind, client: blank(i.client), subLabel: blank(i.subLabel), scopeCidrs, domain: blank(i.domain), startsAt, endsAt,
    timeboxStart: exam ? (i.timeboxStart ?? null) : null, timeboxMinutes,
  };
}

/** hosts.rs `normalise`: the name defaults to the IP; os and access are checked; absent dual-homed and AD set keep. */
function cleanHost(i: HostInput) {
  const raw = i.ip?.trim();
  const ip = raw ? singleIp(raw) : null;
  if (raw && !ip) throw invalid("ip", "must be a single IPv4 address");
  const name = i.name.trim() || ip || "";
  if (!name || [...name].length > 80) throw invalid("name", "name must be 1-80 characters");
  const os = blank(i.os);
  if (os !== null && !["windows", "linux", "other"].includes(os)) throw invalid("os", "os must be windows, linux or other");
  const access = blank(i.access) ?? "none";
  if (!["none", "user", "root"].includes(access)) throw invalid("access", "access must be none, user or root");
  return { name, ip, os: os as HostInput["os"], access: access as NonNullable<HostInput["access"]> };
}

const ipTaken = (engagementId: string, ip: string, exceptId: string) =>
  db.hosts.some((h) => h.engagementId === engagementId && h.ip === ip && h.id !== exceptId);

function newHost(engagementId: string, over: Partial<FakeHost>): FakeHost {
  const h: FakeHost = {
    id: nid("h"), engagementId, name: "", ip: null, os: null, boardColumn: "information-gathering", boardManual: false, access: "none",
    createdAt: now(), updatedAt: now(), dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...over,
  };
  db.hosts.push(h);
  return h;
}

/** hosts.rs `sync_scope`: a host named after its IP for each single-IP scope entry no host has yet. */
function syncScope(engagementId: string, scope: string[]): void {
  for (const entry of scope) {
    const ip = singleIp(entry.trim());
    if (ip && !ipTaken(engagementId, ip, "")) newHost(engagementId, { name: ip, ip });
  }
}

/** hosts.rs `ip_key`: the IPv4 address as a number, for the host list's order. */
function ipKey(ip: string | null): number | null {
  const parts = (ip ?? "").split(".").map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0) ? parts.reduce((a, p) => a * 256 + p, 0) : null;
}
/** hosts.rs `list`: by IP numerically (hosts without one last), then name, then id. */
function byIp(a: FakeHost, b: FakeHost): number {
  const [ka, kb] = [ipKey(a.ip), ipKey(b.ip)];
  if ((ka === null) !== (kb === null)) return ka === null ? 1 : -1;
  if (ka !== null && kb !== null && ka !== kb) return ka - kb;
  const [na, nb] = [a.name.toLowerCase(), b.name.toLowerCase()];
  if (na !== nb) return na < nb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------- deletes, as the schema's foreign keys cascade them
// Each mirrors the ON DELETE CASCADE / SET NULL clauses in src-tauri/migrations, so a delete in the fake leaves what
// a delete in the store leaves.

function dropServices(ids: Set<string>): void {
  if (!ids.size) return;
  db.services = db.services.filter((s) => !ids.has(s.id));
  db.ruledOut = db.ruledOut.filter((r) => !(r.sourceKind === "service" && r.sourceId !== null && ids.has(r.sourceId)));
  for (const f of db.findings) f.serviceIds = f.serviceIds.filter((id) => !ids.has(id));
}

function dropLogEntries(ids: Set<string>): void {
  if (!ids.size) return;
  const attachments = new Set(
    db.log.filter((e) => ids.has(e.id)).flatMap((e) => ("attachmentId" in e.content && e.content.attachmentId ? [e.content.attachmentId] : [])),
  );
  db.log = db.log.filter((e) => !ids.has(e.id));
  db.attachments = db.attachments.filter((a) => !attachments.has(a.id));
  db.extractions = db.extractions.filter((x) => !ids.has(x.logEntryId));
  for (const f of db.findings) f.stepEntryIds = f.stepEntryIds.filter((id) => !ids.has(id));
  const unlink = <T extends { logEntryId: string | null }>(rows: T[]) => rows.forEach((r) => r.logEntryId !== null && ids.has(r.logEntryId) && (r.logEntryId = null));
  unlink(db.hops);
  unlink(db.accessGrants);
  unlink(db.credAttempts);
  unlink(db.failedAttempts);
  unlink(db.triedPairs);
  for (const s of db.services) if (s.confirmedEntryId !== null && ids.has(s.confirmedEntryId)) s.confirmedEntryId = null;
  for (const i of db.hostIdentity) if (i.entryId !== null && ids.has(i.entryId)) i.entryId = null;
  for (const c of db.cleanup) if (c.sourceEntryId !== null && ids.has(c.sourceEntryId)) c.sourceEntryId = null;
}

function dropCredentials(ids: Set<string>): void {
  if (!ids.size) return;
  db.credentials = db.credentials.filter((c) => !ids.has(c.id));
  db.credAttempts = db.credAttempts.filter((a) => !ids.has(a.credId));
  for (const c of db.credentials) {
    if (c.crackedFrom !== null && ids.has(c.crackedFrom)) c.crackedFrom = null;
    if (c.fromSecretId !== null && ids.has(c.fromSecretId)) c.fromSecretId = null;
  }
}

function dropUsernames(ids: Set<string>): void {
  if (!ids.size) return;
  db.usernames = db.usernames.filter((u) => !ids.has(u.id));
  db.accessGrants = db.accessGrants.filter((g) => !ids.has(g.usernameId));
  db.credAttempts = db.credAttempts.filter((a) => a.usernameId === null || !ids.has(a.usernameId));
}

function dropFindings(ids: Set<string>): void {
  if (!ids.size) return;
  db.findings = db.findings.filter((f) => !ids.has(f.id));
  db.findingFiles = db.findingFiles.filter((f) => !ids.has(f.findingId));
  for (const a of db.failedAttempts) if (a.findingId !== null && ids.has(a.findingId)) a.findingId = null;
}

function dropHosts(ids: Set<string>): void {
  if (!ids.size) return;
  const has = (id: string | null) => id !== null && ids.has(id);
  db.hosts = db.hosts.filter((h) => !ids.has(h.id));
  dropServices(new Set(db.services.filter((s) => ids.has(s.hostId)).map((s) => s.id)));
  db.notes = db.notes.filter((n) => !has(n.hostId));
  db.ruledOut = db.ruledOut.filter((r) => !has(r.hostId));
  db.tunnels = db.tunnels.filter((t) => !ids.has(t.viaHostId));
  db.hops = db.hops.filter((h) => !has(h.fromHostId) && !ids.has(h.toHostId));
  db.interfaceDismissals = db.interfaceDismissals.filter((d) => !ids.has(d.hostId));
  db.accessGrants = db.accessGrants.filter((g) => !ids.has(g.hostId));
  db.credAttempts = db.credAttempts.filter((a) => !ids.has(a.hostId));
  db.triedPairs = db.triedPairs.filter((t) => !ids.has(t.hostId));
  db.payloadBuilds = db.payloadBuilds.filter((b) => !ids.has(b.hostId));
  db.hostIdentity = db.hostIdentity.filter((i) => !ids.has(i.hostId));
  db.vectors = db.vectors.filter((v) => !ids.has(v.hostId));
  // checklist_items.owner_id has no foreign key; hosts.rs `delete` clears a host's items by hand.
  db.checklist = db.checklist.filter((c) => !ids.has(c.ownerId));
  for (const e of db.engagements) if (has(e.msfHostId)) e.msfHostId = null;
  for (const c of db.credentials) {
    if (has(c.localHostId)) c.localHostId = null;
    if (has(c.sourceHostId)) c.sourceHostId = null;
  }
  for (const u of db.usernames) if (has(u.sourceHostId)) u.sourceHostId = null;
  for (const a of db.failedAttempts) if (has(a.hostId)) a.hostId = null;
  for (const c of db.cleanup) if (has(c.hostId)) c.hostId = null;
  for (const f of db.findings) f.hostIds = f.hostIds.filter((id) => !ids.has(id));
  for (const e of db.log) e.hostIds = e.hostIds.filter((id) => !ids.has(id));
}

function dropEngagement(id: string): void {
  const mine = <T extends { engagementId: string; id: string }>(rows: T[]) => new Set(rows.filter((r) => r.engagementId === id).map((r) => r.id));
  dropHosts(mine(db.hosts));
  dropLogEntries(mine(db.log));
  dropCredentials(mine(db.credentials));
  dropUsernames(mine(db.usernames));
  dropFindings(mine(db.findings));
  const reports = mine(db.reports);
  db.reports = db.reports.filter((r) => !reports.has(r.id));
  db.reportSections = db.reportSections.filter((s) => !reports.has(s.reportId));
  const rest = <T extends { engagementId: string }>(rows: T[]) => rows.filter((r) => r.engagementId !== id);
  db.notes = rest(db.notes);
  db.ruledOut = rest(db.ruledOut);
  db.tunnels = rest(db.tunnels);
  db.hops = rest(db.hops);
  db.interfaceDismissals = rest(db.interfaceDismissals);
  db.accessGrants = rest(db.accessGrants);
  db.credAttempts = rest(db.credAttempts);
  db.triedPairs = rest(db.triedPairs);
  db.payloadBuilds = rest(db.payloadBuilds);
  db.extractions = rest(db.extractions);
  db.failedAttempts = rest(db.failedAttempts);
  db.cleanup = rest(db.cleanup);
  db.checklist = db.checklist.filter((c) => c.ownerId !== id);
  db.engagements = db.engagements.filter((e) => e.id !== id);
  delete progress[id];
}

// ---------------------------------------------------------------- checklist, as checklist.rs

const MAX_ITEMS = 500;

/** The owner must be the engagement itself or one of its hosts; otherwise `not_found`. */
function checkOwned(engagementId: string, ownerId: string): void {
  if (ownerId !== engagementId && !db.hosts.some((h) => h.id === ownerId && h.engagementId === engagementId)) throw notFound();
}

function checkGoalRefs(engagementId: string, field: string, set: GoalRef[], revert: GoalRef[]): void {
  if (set.length + revert.length > MAX_ITEMS * 4) throw invalid(field, "too many items");
  engagementMustExist(engagementId);
  for (const g of [...set, ...revert]) {
    checkOwned(engagementId, g.ownerId);
    if (!g.goalId.trim()) throw invalid("goalId", "goal id is required");
  }
}

const checklistRow = (g: GoalRef) => db.checklist.find((c) => c.ownerId === g.ownerId && c.goalId === g.goalId);

/** A conditional write's new row (checklist.rs `apply_cover` and `apply_facts` insert these). */
function insertChecklist(g: GoalRef, status: "na" | "done", completedAt: number | null): void {
  db.checklist.push({
    ownerId: g.ownerId, goalId: g.goalId, status, notes: null, completedAt, auto: true, autoFrom: null, statusManual: false, evidence: [], updatedAt: now(),
  });
}

/** Create/update helper: merges `input` over the row, ignoring undefined so "absent keeps the current value" holds. */
function assign<T extends object>(row: T, input: object, extra: Partial<T> = {}): T {
  for (const [k, v] of Object.entries(input)) if (v !== undefined) (row as Record<string, unknown>)[k] = v;
  return Object.assign(row, extra);
}

/**
 * The store's same-domain rule (credentials.rs `same_domain`), so the audit backend dedupes as the real one does:
 * equal ignoring case, or the engagement's own FQDN and its first label.
 */
function sameDomainIn(engagementId: string, a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const [x, y] = [norm(a), norm(b)];
  if (x === y) return true;
  const fqdn = norm(db.engagements.find((e) => e.id === engagementId)?.domain);
  const label = fqdn.includes(".") ? fqdn.slice(0, fqdn.indexOf(".")) : "";
  if (!label || !x || !y) return false;
  return (x === fqdn && y === label) || (y === fqdn && x === label);
}

/** The stored credential that is the same credential as `c` (credentials.rs `find_duplicate`). */
function storedSame(c: Credential): Credential | undefined {
  if (!(c.type === "hash" ? c.secret.trim() : stripLineBreaks(c.secret))) return undefined;
  const key = (x: Credential) => `${credKey({ ...x, domain: null })}|${x.scope === "local" ? (x.localHostId ?? "") : ""}`;
  const same = db.credentials.filter((x) => x.engagementId === c.engagementId && x.secret && key(x) === key(c));
  return same.find((x) => sameDomainIn(c.engagementId, x.domain, c.domain));
}

/**
 * A credential input's scope and local host, checked as credentials.rs `build` does: absent scope is `domain`; a local
 * credential needs its host only when scope or host is being set or changed (`current` is the stored credential on
 * update), so one whose host was deleted stays editable; only a local credential has a host.
 */
function scopeAndHost(input: CredentialInput, current?: Credential): Pick<Credential, "scope" | "localHostId"> {
  const scope = input.scope || "domain";
  const localHostId = input.localHostId || null;
  const keeps = current !== undefined && current.scope === scope && current.localHostId === localHostId;
  if (scope === "local" && !localHostId && !keeps) throw invalid("localHostId", "a local credential needs its host");
  if (scope !== "local" && localHostId) throw invalid("localHostId", "only a local credential has a host");
  return { scope, localHostId };
}

function listChecklist(engagementId: string): ChecklistItem[] {
  const owners = new Set([engagementId, ...db.hosts.filter((h) => h.engagementId === engagementId).map((h) => h.id)]);
  // The store always sends `statusManual`; a fixture row may leave it out.
  return clone(db.checklist.filter((c) => owners.has(c.ownerId)).map((c) => ({ ...c, statusManual: c.statusManual ?? false })));
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

/**
 * `extraction_file` over this fake's own writes: files the proofs and stores the extraction, its record found by
 * comparing the rows before and after. Unlike the store it is not all or nothing, skips the tried-pair check on
 * failed username results, and leaves username re-keys and secret links out.
 */
async function fileExtraction(engagementId: string, logEntryId: string, p: ExtractionProofs): Promise<Filed> {
  if (db.extractions.some((x) => x.logEntryId === logEntryId)) throw new RavenError("conflict", "this entry's extraction is already recorded");
  const at = find(db.log, logEntryId).at;
  const mine = <T extends { engagementId: string }>(rows: T[]) => clone(rows.filter((r) => r.engagementId === engagementId));
  const was = { credentials: mine(db.credentials), usernames: mine(db.usernames), attempts: mine(db.credAttempts), tried: mine(db.triedPairs) };
  const hostIds: Record<string, string> = {};
  const host = (id: string | null | undefined) => (id ? (hostIds[id] ?? id) : null);
  const record: ExtractionRecord = {
    createdHostIds: [...p.createdHostIds], createdServiceIds: [], servicesBefore: [], hostOsBefore: [], identityBefore: [], createdCredentialIds: [],
    credentialsBefore: [], createdUsernameIds: [], createdAttemptIds: [], attemptsBefore: [], createdTriedPairIds: [], createdVectorIds: [],
    outputTicks: [], reprovedCredentialIds: [], reprovedUsernameIds: [], promotedTriedPairs: [],
  };
  const reprove = (ids: string[], stored: { id: string }[], id: string) => {
    if (stored.some((x) => x.id === id) && !ids.includes(id)) ids.push(id);
  };
  for (const h of p.newHosts) {
    let id = db.hosts.find((x) => x.engagementId === engagementId && x.ip === h.ip)?.id;
    if (!id) {
      id = (await base.hostCreate(engagementId, { name: h.ip, ip: h.ip })).id;
      record.createdHostIds.push(id);
    }
    hostIds[h.key] = id;
  }
  const scans: Filed["scans"] = [];
  for (const s of p.scans) {
    const hostId = host(s.hostId)!;
    const before = clone(db.services.filter((x) => x.hostId === hostId));
    const scanned = (await base.servicesUpsertScan(hostId, s.ports)).filter((x) => s.ports.some((pt) => pt.port === x.port && pt.protocol === x.protocol));
    for (const x of scanned) {
      const old = before.find((b) => b.id === x.id);
      if (old) record.servicesBefore.push(old);
      else record.createdServiceIds.push(x.id);
    }
    const h = find(db.hosts, hostId);
    const osSet = !h.os && !!s.os;
    if (osSet) {
      record.hostOsBefore.push({ hostId, os: h.os });
      await base.hostUpdate(hostId, { name: h.name, ip: h.ip, os: s.os as Host["os"], access: h.access });
    }
    scans.push({ hostId, services: scanned.length, osSet });
  }
  let identityChanged = false;
  if (p.identity) {
    const hostId = host(p.identity.hostId)!;
    const before = clone(db.hostIdentity.find((i) => i.hostId === hostId) ?? null);
    const fields = (i: { username: string; privileges: string[]; groups: string[] }) => JSON.stringify([i.username, i.privileges, i.groups]);
    if (!before || fields(before) !== fields(p.identity)) {
      await base.hostIdentitySet({ ...p.identity, hostId, entryId: logEntryId });
      record.identityBefore.push({ hostId, identity: before });
      identityChanged = true;
    }
  }
  const create = async (c: CredentialInput) => {
    const { credential, existed } = await base.credentialCreate(engagementId, { ...c, localHostId: host(c.localHostId), sourceHostId: host(c.sourceHostId) });
    if (existed) reprove(record.reprovedCredentialIds, was.credentials, credential.id);
    return credential.id;
  };
  const proofIds: string[] = [];
  for (const c of p.credentials) proofIds.push(await create(c));
  const cracked: Filed["cracked"] = [];
  for (const k of p.cracks) {
    for (const id of new Set([...k.credentialIds, ...k.proofCredentials.map((i) => proofIds[i]!)])) {
      if (find(db.credentials, id).crackStatus === "cracked") reprove(record.reprovedCredentialIds, was.credentials, id);
      else {
        await base.credentialCrack(id, k.plaintext);
        cracked.push({ hashId: id, plaintext: k.plaintext });
      }
    }
  }
  for (const u of p.usernames) {
    reprove(record.reprovedUsernameIds, was.usernames, (await base.usernameCreate(engagementId, { ...u, sourceHostId: host(u.sourceHostId) })).id);
  }
  if (p.intake) {
    const plan = p.intake;
    const userIds = new Map<string, string>();
    for (const u of plan.usernames) userIds.set(u.key, (await base.usernameCreate(engagementId, { ...u.input, sourceHostId: host(u.input.sourceHostId) })).id);
    const upsert = async (rows: PlannedAttemptProof[], credId?: string) => {
      const inputs = rows.flatMap((a) => {
        const usernameId = a.usernameId ?? (a.usernameKey ? userIds.get(a.usernameKey) : undefined);
        if (a.usernameKey && !usernameId) return [];
        return [{ ...a, credId: credId ?? a.credId ?? "", usernameId: usernameId ?? null, hostId: host(a.hostId)!, logEntryId, at }];
      });
      if (inputs.length) await base.credAttemptsUpsert(engagementId, inputs);
    };
    const ids: (string | null)[] = [];
    for (const c of plan.credentials) ids.push(c.accepted ? await create(c.input) : null);
    await upsert(plan.attempts);
    for (const [i, c] of plan.credentials.entries()) await (ids[i] ? upsert(c.attempts, ids[i]!) : upsert(c.ifDeclined));
    for (const h of plan.hashes) await create(h);
    for (const id of plan.reprovedCredentialIds) reprove(record.reprovedCredentialIds, was.credentials, id);
    for (const id of plan.reprovedUsernameIds) reprove(record.reprovedUsernameIds, was.usernames, id);
  }
  if (p.triedPairs.length) await base.triedPairsUpsert(engagementId, p.triedPairs.map((t) => ({ ...t, hostId: host(t.hostId)!, logEntryId, at })));
  const vectors: Filed["vectors"] = [];
  for (const v of p.vectors) {
    const hostId = host(v.hostId)!;
    const known = db.vectors.some((x) => x.hostId === hostId && x.title === v.title.trim());
    const row = await base.vectorUpsert(hostId, { title: v.title, status: "try", source: "auto" });
    if (!known) {
      record.createdVectorIds.push(row.id);
      vectors.push(row);
    }
  }
  // What the summary counts is read before the promotion, whose failures earlier entries recorded.
  const attempts = mine(db.credAttempts).filter((a) => was.attempts.find((b) => b.id === a.id)?.result !== a.result);
  const triedPairsAdded = mine(db.triedPairs).filter((t) => !was.tried.some((b) => b.id === t.id)).length;
  for (const c of mine(db.credentials).filter((x) => !was.credentials.some((b) => b.id === x.id))) {
    const pairs = db.triedPairs.filter(
      (t) => t.engagementId === engagementId && t.username.toLowerCase() === c.username.toLowerCase() && t.secret === c.secret && sameDomainIn(engagementId, t.domain, c.domain),
    );
    if (!pairs.length) continue;
    const rows = await base.credAttemptsUpsert(engagementId, pairs.map((t) => ({
      credId: c.id, hostId: t.hostId, service: t.service as AttemptService, result: "failed" as const, authMode: t.authMode, logEntryId: t.logEntryId, at: t.at,
    })));
    db.triedPairs = db.triedPairs.filter((t) => !pairs.includes(t));
    const stored = pairs.filter((t) => was.tried.some((b) => b.id === t.id));
    if (stored.length) record.promotedTriedPairs!.push({ credentialId: c.id, triedPairs: clone(stored), attempts: rows.filter((a) => a.credId === c.id) });
  }
  for (const c of mine(db.credentials)) {
    const old = was.credentials.find((b) => b.id === c.id);
    if (!old) record.createdCredentialIds.push(c.id);
    else if (JSON.stringify(old) !== JSON.stringify(c)) record.credentialsBefore.push(old);
  }
  record.createdUsernameIds = mine(db.usernames).filter((u) => !was.usernames.some((b) => b.id === u.id)).map((u) => u.id);
  for (const a of mine(db.credAttempts)) {
    const old = was.attempts.find((b) => b.id === a.id);
    if (!old) record.createdAttemptIds.push(a.id);
    else if (JSON.stringify(old) !== JSON.stringify(a)) record.attemptsBefore.push(old);
  }
  record.createdTriedPairIds = mine(db.triedPairs).filter((t) => !was.tried.some((b) => b.id === t.id)).map((t) => t.id);
  const named = new Set([...record.createdCredentialIds, ...record.credentialsBefore.map((c) => c.id), ...attempts.map((a) => a.credId)]);
  const extraction: Extraction = { logEntryId, engagementId, summary: { wins: [], counts: [], ticks: [] }, record, createdAt: now(), undoneAt: null };
  db.extractions.push(extraction);
  const credentials = mine(db.credentials).filter((c) => named.has(c.id));
  return clone({ extraction, hostIds, scans, identityChanged, attempts, credentials, triedPairsAdded, cracked, vectors });
}

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
  fieldManualScan: async () => unsupported("Field-Manual scan"),
  fieldManualLatestMtime: async () => null,
  fieldManualSave: async () => null,
  fieldManualLoad: async () => clone(AUDIT_FIELD_MANUAL),
  openObsidian: async () => {},
  // The export can't compile a PDF in the browser: it answers as the app would, with a fixed size and MD5, so the
  // audit sees the result panel. The real PDF is judged from `cargo run --example export_report`.
  reportExport: async (reportId: string, input) => {
    const report = find(db.reports, reportId);
    // What the button sent, with its screenshots, for `audit/export-report.mjs` to compile with the real backend.
    (globalThis as { __ravenLastExport?: unknown }).__ravenLastExport = {
      input: clone(input),
      images: Object.fromEntries(input.attachmentIds.map((id: string) => [id, db.attachments.find((a) => a.id === id)?.dataBase64 ?? null])),
    };
    report.exportedAt = now();
    const archiveBytes = 1_284_096;
    return {
      pdfPath: `${input.folder}/${input.fileStem}.pdf`,
      pdfBytes: 1_402_880,
      archivePath: `${input.folder}/${input.fileStem}.7z`,
      archiveBytes,
      md5: "5d41402abc4b2a76b9719d911017c592",
      pages: 31,
      tooLarge: false,
    };
  },
  pickFolder: async () => "/Users/sam/Documents/OSCP exam",
  revealInFinder: async () => {},
  backupRestore: async () => unsupported("Restore"),
  backupRestoreLocked: async () => unsupported("Restore"),

  engagementsList: async () => clone(db.engagements),
  engagementGet: async (id: string) => clone(find(db.engagements, id)),
  engagementCreate: async (input) => {
    const e: (typeof db.engagements)[number] = {
      ...cleanEngagement(input), id: nid("e"), status: "active", createdAt: now(), updatedAt: now(), lastActivityAt: null, lastRanOn: null,
      msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
    };
    db.engagements.push(e);
    syncScope(e.id, e.scopeCidrs);
    return clone(e);
  },
  engagementUpdate: async (id: string, input) => {
    const clean = cleanEngagement(input);
    const e = find(db.engagements, id);
    // hosts.rs `sync_scope_added`: only IPs the old scope did not list become hosts, so a deleted host stays deleted.
    const before = new Set(e.scopeCidrs.flatMap((c) => singleIp(c.trim()) ?? []));
    const added = clean.scopeCidrs.filter((c) => { const ip = singleIp(c.trim()); return ip !== null && !before.has(ip); });
    const noTimebox = clean.timeboxStart === null || clean.timeboxMinutes === null;
    Object.assign(e, clean, { updatedAt: now() }, noTimebox ? { timeboxPausedMs: 0, timeboxPausedAt: null } : {});
    syncScope(id, added);
    return clone(e);
  },
  engagementSetStatus: async (id: string, status) => {
    if (status !== "active" && status !== "archived") throw invalid("status", "status must be active or archived");
    return clone(assign(find(db.engagements, id), { status }, { updatedAt: now() }));
  },
  engagementSetMsfHost: async (engagementId: string, hostId: string | null) => {
    engagementMustExist(engagementId);
    if (hostId !== null && !db.hosts.some((h) => h.id === hostId && h.engagementId === engagementId)) throw notFound();
    return clone(assign(find(db.engagements, engagementId), { msfHostId: hostId }, { updatedAt: now() }));
  },
  engagementSetTimeboxPaused: async (id: string, paused: boolean) => {
    const e = find(db.engagements, id);
    const t = now();
    if (paused && e.timeboxPausedAt === null) return clone(assign(e, { timeboxPausedAt: t }, { updatedAt: t }));
    if (!paused && e.timeboxPausedAt !== null)
      return clone(assign(e, { timeboxPausedMs: e.timeboxPausedMs + (t - e.timeboxPausedAt), timeboxPausedAt: null }, { updatedAt: t }));
    return clone(e);
  },
  engagementDelete: async (id: string) => {
    engagementMustExist(id);
    dropEngagement(id);
    return null;
  },

  hostsList: async (engagementId: string) => db.hosts.filter((h) => h.engagementId === engagementId).sort(byIp).map(hostOut),
  hostCreate: async (engagementId: string, input) => {
    const c = cleanHost(input);
    engagementMustExist(engagementId);
    if (c.ip && ipTaken(engagementId, c.ip, "")) throw invalid("ip", "A host with this IP already exists");
    return hostOut(newHost(engagementId, { ...c, dualHomed: input.dualHomed ?? false, adSet: input.adSet ?? null }));
  },
  hostUpdate: async (id: string, input) => {
    const c = cleanHost(input);
    const h = find(db.hosts, id);
    if (c.ip && ipTaken(h.engagementId, c.ip, id)) throw invalid("ip", "A host with this IP already exists");
    return hostOut(Object.assign(h, c, {
      updatedAt: now(), ...(input.dualHomed !== undefined ? { dualHomed: input.dualHomed } : {}), ...(input.adSet !== undefined ? { adSet: input.adSet } : {}),
    }));
  },
  hostMove: async (id: string, column) => {
    if (!BOARD_COLUMNS.includes(column)) throw invalid("column", "column must be one of the six PEN-200 stages");
    return hostOut(assign(find(db.hosts, id), {}, { boardColumn: column, boardManual: true, updatedAt: now() }));
  },
  hostSyncBoard: async (hostId: string, derived) => {
    const h = find(db.hosts, hostId);
    if (!h.boardManual) h.boardColumn = derived;
    h.boardDerived = derived;
    return hostOut(h);
  },
  hostDelete: async (id: string) => {
    find(db.hosts, id);
    dropHosts(new Set([id]));
    return null;
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
    // services.rs `create`: port and protocol checked, the host must exist, one service per port and protocol.
    if (!(input.port >= 1 && input.port <= 65535)) throw invalid("port", "port must be 1-65535");
    const protocol = (input.protocol ?? "tcp").trim().toLowerCase() as Service["protocol"];
    if (protocol !== "tcp" && protocol !== "udp") throw invalid("protocol", "protocol must be tcp or udp");
    find(db.hosts, hostId);
    if (db.services.some((x) => x.hostId === hostId && x.port === input.port && x.protocol === protocol)) {
      throw invalid("port", "A service on this port and protocol already exists");
    }
    const s = { id: nid("s"), hostId, port: input.port, protocol, state: "open", nmapService: input.nmapService ?? null, nmapVersion: input.nmapVersion ?? null, confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: now(), updatedAt: now() };
    db.services.push(s);
    return clone(s);
  },
  serviceUpdate: async (id: string, input) => clone(assign(find(db.services, id), input, { updatedAt: now() })),
  serviceConfirm: async (id: string, input) =>
    clone(assign(find(db.services, id), {}, { confirmedProduct: input.product, confirmedVersion: input.version ?? null, confirmedEntryId: input.entryId ?? null, updatedAt: now() })),
  serviceUnconfirm: async (id: string) =>
    clone(assign(find(db.services, id), {}, { confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, updatedAt: now() })),
  serviceDelete: async (id: string) => {
    find(db.services, id);
    dropServices(new Set([id]));
    return null;
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
  logDelete: async (id: string) => {
    find(db.log, id);
    dropLogEntries(new Set([id]));
    return null;
  },

  checklistList: async (engagementId: string) => listChecklist(engagementId),
  checklistPut: async (engagementId: string, items) => {
    // checklist.rs `put`: every item is checked before any is written, so a bad one writes nothing.
    if (items.length > MAX_ITEMS) throw invalid("items", "too many items (max 500)");
    engagementMustExist(engagementId);
    for (const it of items) {
      if (!it.goalId.trim()) throw invalid("goalId", "goal id is required");
      if (!["todo", "in_progress", "done", "na"].includes(it.status)) throw invalid("status", "status must be todo, in_progress, done or na");
      if (it.autoFrom != null && it.autoFrom !== "na" && it.autoFrom !== "in_progress") throw invalid("autoFrom", "autoFrom must be na or in_progress");
      checkOwned(engagementId, it.ownerId);
    }
    for (const it of items) {
      const i = db.checklist.findIndex((c) => c.ownerId === it.ownerId && c.goalId === it.goalId);
      // A write that leaves `statusManual` out keeps the stored value (auto ticks never clear a status set by hand).
      const row: ChecklistItem = {
        ownerId: it.ownerId, goalId: it.goalId, status: it.status, notes: it.notes ?? null, completedAt: it.completedAt ?? null, auto: it.auto ?? false,
        autoFrom: it.autoFrom ?? null, statusManual: it.statusManual ?? (i >= 0 ? db.checklist[i]!.statusManual : undefined) ?? false,
        evidence: it.evidence ?? [], updatedAt: now(),
      };
      if (i >= 0) db.checklist[i] = row;
      else db.checklist.push(row);
    }
    return listChecklist(engagementId);
  },
  // checklist.rs `apply_cover`: `cover` goals become na/auto only where untouched; `revert` only undoes cover marks.
  checklistApplyCover: async (engagementId: string, cover, revert) => {
    checkGoalRefs(engagementId, "cover", cover, revert);
    for (const g of revert) {
      const r = checklistRow(g);
      if (r && r.status === "na" && r.auto && !r.statusManual) Object.assign(r, { status: "todo", auto: false, autoFrom: null, completedAt: null, updatedAt: now() });
    }
    for (const g of cover) {
      const r = checklistRow(g);
      if (!r) insertChecklist(g, "na", null);
      else if (r.status === "todo" && !r.auto && !r.statusManual) Object.assign(r, { status: "na", auto: true, autoFrom: null, completedAt: null, updatedAt: now() });
    }
    return listChecklist(engagementId);
  },
  // checklist.rs `apply_facts`: `done` goals become done/auto only where untouched; `revert` only undoes fact marks.
  checklistApplyFacts: async (engagementId: string, done, revert) => {
    checkGoalRefs(engagementId, "facts", done, revert);
    for (const g of revert) {
      const r = checklistRow(g);
      if (r && r.status === "done" && r.auto && !r.statusManual && r.evidence.length === 0) {
        Object.assign(r, { status: "todo", auto: false, autoFrom: null, completedAt: null, updatedAt: now() });
      }
    }
    for (const g of done) {
      const r = checklistRow(g);
      if (!r) insertChecklist(g, "done", now());
      else if (r.status === "todo" && !r.auto && !r.statusManual) Object.assign(r, { status: "done", auto: true, autoFrom: null, completedAt: now(), updatedAt: now() });
    }
    return listChecklist(engagementId);
  },

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
  interfaceDismissalsList: async (engagementId: string) =>
    clone(db.interfaceDismissals.filter((d) => d.engagementId === engagementId)),
  interfaceDismiss: async (engagementId: string, hostId: string, subnet: string) => {
    if (!db.interfaceDismissals.some((d) => d.hostId === hostId && d.subnet === subnet)) {
      db.interfaceDismissals.push({ engagementId, hostId, subnet, createdAt: now() });
    }
    return null;
  },
  hopsList: async (engagementId: string) => clone(db.hops.filter((h) => h.engagementId === engagementId)),
  hopCreate: async (engagementId: string, input) => {
    const h = { fromHostId: null, logEntryId: null, ...input, id: nid("hp"), engagementId, at: input.at ?? now(), updatedAt: now() };
    db.hops.push(h);
    return clone(h);
  },
  hopUpdate: async (id: string, input) => clone(assign(find(db.hops, id), input, { updatedAt: now() })),
  hopDelete: async (id: string) => remove(db.hops, id),
  hostMarkAccessReviewed: async (hostId: string) => hostOut(assign(find(db.hosts, hostId), {}, { accessReviewedAt: now() })),

  credentialsList: async (engagementId: string) => clone(db.credentials.filter((c) => c.engagementId === engagementId)),
  credentialCreate: async (engagementId: string, input) => {
    const c = {
      username: "", domain: null, secret: "", hashType: null, sourceHostId: null, source: null, notes: null,
      crackStatus: input.type === "hash" ? ("uncracked" as const) : null, crackedFrom: null, fromSecretId: null,
      ...input, ...scopeAndHost(input), id: nid("c"), engagementId, createdAt: now(), updatedAt: now(),
    };
    const stored = storedSame(c);
    if (stored) return { credential: clone(stored), existed: true };
    db.credentials.push(c);
    return { credential: clone(c), existed: false };
  },
  sameDomains: async (engagementId: string, pairs) => pairs.map(([a, b]) => sameDomainIn(engagementId, a, b)),
  credentialUpdate: async (id: string, input) => {
    const c = find(db.credentials, id);
    return clone(assign(c, input, { ...scopeAndHost(input, c), updatedAt: now() }));
  },
  credentialDelete: async (id: string) => {
    find(db.credentials, id);
    dropCredentials(new Set([id]));
    return null;
  },
  // credentials.rs `crack`: a password linked to its hash by `crackedFrom` (or the stored same password, linked if it
  // wasn't yet), and the hash marked cracked.
  credentialCrack: async (hashId: string, plaintext: string) => {
    const hash = find(db.credentials, hashId);
    if (hash.type !== "hash") throw invalid("type", "only a hash can be cracked");
    const secret = stripLineBreaks(plaintext);
    if (!secret.trim()) throw invalid("plaintext", "plaintext is required");
    const c: Credential = {
      ...hash, id: nid("c"), type: "password", secret, hashType: null, notes: null, crackStatus: null, crackedFrom: hash.id, fromSecretId: null,
      createdAt: now(), updatedAt: now(),
    };
    const stored = storedSame(c);
    if (stored && stored.crackedFrom === null) Object.assign(stored, { crackedFrom: hash.id, updatedAt: now() });
    else if (!stored) db.credentials.push(c);
    Object.assign(hash, { crackStatus: "cracked", updatedAt: now() });
    return clone(stored ?? c);
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
    const stored = db.usernames.find((x) =>
      x.engagementId === engagementId && x.username.trim().toLowerCase() === input.username.trim().toLowerCase() && sameDomainIn(engagementId, x.domain, input.domain));
    if (stored) return clone(stored);
    const u ={ domain: null, sourceHostId: null, source: null, ...input, id: nid("u"), engagementId, createdAt: now() };
    db.usernames.push(u);
    return clone(u);
  },
  usernameDelete: async (id: string) => {
    find(db.usernames, id);
    dropUsernames(new Set([id]));
    return null;
  },
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
  payloadBuildsList: async (engagementId: string) => {
    engagementMustExist(engagementId);
    return clone(db.payloadBuilds.filter((b) => b.engagementId === engagementId));
  },
  payloadBuildRecord: async (input) => {
    if (!input.payloadId.trim()) throw new RavenError("validation", "payload id is required", "payloadId");
    const host = db.hosts.find((h) => h.id === input.hostId && h.engagementId === input.engagementId);
    if (!host) throw new RavenError("not_found", "Not found");
    db.payloadBuilds = db.payloadBuilds.filter((b) => !(b.hostId === input.hostId && b.payloadId === input.payloadId));
    db.payloadBuilds.push(clone(input));
    return clone(input);
  },
  reportGetOrCreate: async (engagementId: string) => {
    if (!db.engagements.some((e) => e.id === engagementId)) throw new RavenError("not_found", "Not found");
    let report = db.reports.find((r) => r.engagementId === engagementId);
    if (!report) {
      // As the backend does: name, email and OSID default from Settings.
      const { reportName, reportEmail, reportOsid } = db.settings;
      report = {
        id: nid("rep"), engagementId, candidateName: reportName ?? "", email: reportEmail ?? "", osid: reportOsid ?? "", title: "OSCP Exam Report", meta: {},
        createdAt: now(), updatedAt: now(), exportedAt: null,
      } satisfies Report;
      db.reports.push(report);
    }
    return clone(report);
  },
  reportUpdate: async (id: string, patch) => {
    const report = db.reports.find((r) => r.id === id);
    if (!report) throw new RavenError("not_found", "Not found");
    if (patch.title !== undefined && !patch.title.trim()) throw new RavenError("validation", "title is required", "title");
    // As the backend: a field left out keeps its value.
    Object.assign(report, {
      candidateName: patch.candidateName ?? report.candidateName,
      email: patch.email ?? report.email,
      osid: patch.osid ?? report.osid,
      title: patch.title ?? report.title,
      meta: patch.meta === undefined ? report.meta : clone(patch.meta),
      updatedAt: now(),
    });
    return clone(report);
  },
  reportSectionsList: async (reportId: string) =>
    clone(db.reportSections.filter((s) => s.reportId === reportId).sort((a, b) => a.position - b.position || a.kind.localeCompare(b.kind))),
  reportSectionUpsert: async (reportId: string, input) => {
    if (!db.reports.some((r) => r.id === reportId)) throw new RavenError("not_found", "Not found");
    const key = input.targetKey ?? null;
    const needsKey = input.kind === "target" || input.kind === "page" ? !!key?.trim() : input.kind === "ad" ? key === "ad-set" : key === null;
    if (!needsKey) throw new RavenError("validation", "invalid target key for this section", "targetKey");
    let section = db.reportSections.find((s) => s.reportId === reportId && s.kind === input.kind && s.targetKey === key);
    if (section) Object.assign(section, clone(input), { targetKey: key, updatedAt: now() });
    else {
      section = { ...clone(input), targetKey: key, id: nid("rs"), reportId, updatedAt: now() } satisfies ReportSection;
      db.reportSections.push(section);
    }
    return clone(section);
  },
  reportSectionSave: async (id: string, doc, meta) => {
    const section = db.reportSections.find((s) => s.id === id);
    if (!section) throw new RavenError("not_found", "Not found");
    Object.assign(section, { doc: clone(doc), meta: clone(meta), updatedAt: now() });
    return clone(section);
  },
  reportSectionsReorder: async (reportId: string, ids: string[]) => {
    const mine = ids.map((id) => db.reportSections.find((s) => s.id === id && s.reportId === reportId));
    if (mine.some((s) => !s)) throw new RavenError("not_found", "Not found");
    mine.forEach((s, i) => {
      if (s) s.position = i;
    });
    return null;
  },
  reportSectionsSave: async (reportId: string, writes, deletePage = null) => {
    const mine = writes.map((w) => db.reportSections.find((s) => s.id === w.id && s.reportId === reportId));
    if (mine.some((s) => !s)) throw new RavenError("not_found", "Not found");
    const gone = deletePage === null ? -1 : db.reportSections.findIndex((s) => s.id === deletePage && s.reportId === reportId);
    if (deletePage !== null && gone === -1) throw new RavenError("not_found", "Not found");
    if (gone !== -1 && db.reportSections[gone].kind !== "page") throw new RavenError("validation", "only pages can be deleted", "kind");
    writes.forEach((w, i) => Object.assign(mine[i]!, { doc: clone(w.doc), meta: clone(w.meta), updatedAt: now() }));
    if (gone !== -1) db.reportSections.splice(gone, 1);
    return mine.map((s) => clone(s!));
  },
  reportSectionDelete: async (reportId: string, id: string) => {
    const at = db.reportSections.findIndex((s) => s.id === id && s.reportId === reportId);
    if (at === -1) throw new RavenError("not_found", "Not found");
    if (db.reportSections[at].kind !== "page") throw new RavenError("validation", "only pages can be deleted", "kind");
    db.reportSections.splice(at, 1);
    return null;
  },
  triedPairsList: async (engagementId: string) => {
    engagementMustExist(engagementId);
    return clone(db.triedPairs.filter((t) => t.engagementId === engagementId));
  },
  triedPairsUpsert: async (engagementId: string, inputs) => {
    const out: TriedPair[] = [];
    for (const i of inputs) {
      const authMode = i.authMode ?? "domain";
      const same = (t: TriedPair) =>
        t.engagementId === engagementId && t.username.toLowerCase() === i.username.toLowerCase() && sameDomainIn(engagementId, t.domain, i.domain) &&
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
      t.engagementId === engagementId && t.username.toLowerCase() === username.toLowerCase() && sameDomainIn(engagementId, t.domain, domain) && t.secret === secret;
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
  extractionFile: async (engagementId: string, logEntryId: string, p: ExtractionProofs) => fileExtraction(engagementId, logEntryId, p),
  extractionFinish: async (logEntryId: string, summary, outputTicks) => {
    const row = db.extractions.find((x) => x.logEntryId === logEntryId);
    if (!row) throw new RavenError("not_found", `No extraction for ${logEntryId}`);
    Object.assign(row,{ summary: clone(summary), record: { ...row.record, outputTicks: clone(outputTicks) }, createdAt: now() });
    return clone(row);
  },
  extractionGet: async (logEntryId: string) => clone(db.extractions.find((x) => x.logEntryId === logEntryId) ?? null),
  extractionsList: async (engagementId: string) => {
    engagementMustExist(engagementId);
    return clone(db.extractions.filter((x) => x.engagementId === engagementId));
  },
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
    for (const p of r.promotedTriedPairs ?? []) db.triedPairs.push(...clone(p.triedPairs));
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

  findingsList: async (engagementId: string) => {
    engagementMustExist(engagementId);
    return clone(db.findings.filter((f) => f.engagementId === engagementId));
  },
  findingCreate: async (engagementId: string, input) => {
    const f = {
      severity: null, cvssVector: null, cvssScore: null, status: "draft" as const, description: "", impact: "", remediation: "", exploitNotes: "",
      lessons: "", refs: [], hostIds: [], serviceIds: [], stepEntryIds: [], ...input, id: nid("f"), engagementId, createdAt: now(), updatedAt: now(),
    };
    db.findings.push(f);
    return clone(f);
  },
  findingUpdate: async (id: string, input) => clone(assign(find(db.findings, id), input, { updatedAt: now() })),
  findingDelete: async (id: string) => {
    find(db.findings, id);
    dropFindings(new Set([id]));
    return null;
  },
  findingFilesList: async (findingId: string) => {
    find(db.findings, findingId);
    return clone(db.findingFiles.filter((f) => f.findingId === findingId));
  },
  findingFileCreate: async (findingId: string, input) => {
    const f = { language: null, modified: false, originalUrl: null, originalContent: null, ...input, id: nid("ff"), findingId, createdAt: now(), updatedAt: now() };
    db.findingFiles.push(f);
    return clone(f);
  },
  findingFileUpdate: async (id: string, input) => clone(assign(find(db.findingFiles, id), input, { updatedAt: now() })),
  findingFileDelete: async (id: string) => remove(db.findingFiles, id),
  failedAttemptsList: async (engagementId: string) => {
    engagementMustExist(engagementId);
    return clone(db.failedAttempts.filter((f) => f.engagementId === engagementId));
  },
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
      // No import yet: the Manual shows its empty state.
      if (name === "fieldManualLoad") return Promise.resolve(null);
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
