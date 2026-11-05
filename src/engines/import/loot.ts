// Maps old-Raven top-level loot (credentials, usernames with access grants, attempts, legacy verifications)
// the way old `normalizeLootState` + `mergeImportedLoot` (store/lootPersistence.ts) read it, plus the host-note
// section for old `lootItems`. plan.ts calls these once the engagements, hosts and log entries are planned.
import type {
  AccessGrant, AccessLevel, AttemptResult, AttemptService, AuthMode, CredAttempt, Credential, CredentialScope,
  CredentialType, CrackStatus, Username,
} from "../../types/credentials";
import { attemptKey, defaultHashType, findDuplicateCredential, stripLineBreaks, usernameKey } from "../credentials/keys";
import type { OldBackup, OldMachine } from "./types";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hasText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const optText = (v: unknown): string | null => (hasText(v) ? v.trim() : null);
const oneOf = <T extends string>(set: Set<string>, v: unknown): T | null => (typeof v === "string" && set.has(v) ? (v as T) : null);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Epoch-ms numbers are kept; ISO strings are parsed; anything else is `fallback`. */
function toMs(v: unknown, fallback: number): number {
  // Whole milliseconds that fit an i64 exactly: Rust stores these as INTEGER.
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return Math.trunc(v);
  if (typeof v === "string") {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
  }
  return fallback;
}

const CRED_TYPES = new Set<string>(["password", "hash", "ticket", "key", "token", "other"]);
const SCOPES = new Set<string>(["domain", "local", "app"]);
const CRACK = new Set<string>(["uncracked", "cracked", "uncrackable"]);
const LEVELS = new Set<string>(["user", "admin", "system"]);
const RESULTS = new Set<string>(["admin", "valid", "failed", "errored"]);
/** Result names used before old loot schema 2. */
const LEGACY_RESULTS: Record<string, AttemptResult> = { tried: "errored", invalid: "failed" };
/** Old per-machine `credential.verifications` status -> attempt result ('untested' carried no information). */
const VERIFICATION_RESULTS: Record<string, AttemptResult> = { admin: "admin", user: "valid", failed: "failed" };
const SERVICES = new Set<string>(["smb", "winrm", "rdp", "mssql", "ssh", "ftp", "ldap", "wmi", "vnc", "nfs", "http", "kerberos", "other"]);
const AUTH_MODES = new Set<string>(["domain", "local"]);
const RESULT_RANK: Record<AttemptResult, number> = { errored: 0, failed: 1, valid: 2, admin: 3 };
const REDACTED = "[REDACTED]";
const LOOT_CATEGORIES = new Set<string>(["flag", "service", "file", "note"]);
/** Ruling T5-R1: a blank `via` is stored as this, so the record stays editable. */
export const VIA_NOT_RECORDED = "(not recorded)";

export interface LootInput {
  hosts: { id: string; engagementId: string }[];
  logEntries: { id: string; engagementId: string }[];
  /** Old engagement id (lab id or standalone machine id) -> imported engagement id. */
  engagementOf: Map<string, string>;
  /** Every lab and standalone id in the backup, selected or not. */
  engagementIdsInBackup: Set<string>;
}

export interface LootPlan {
  credentials: Credential[];
  usernames: Username[];
  accessGrants: AccessGrant[];
  credAttempts: CredAttempt[];
}

/** Old credIdentity: the principal ignoring the secret. An owner-less secret names none. */
const identity = (c: Pick<Credential, "engagementId" | "type" | "username" | "domain">): string | null =>
  c.username.trim()
    ? `${c.engagementId}|${c.type}|${c.username.trim().toLowerCase()}|${(c.domain ?? "").trim().toLowerCase()}`
    : null;

/**
 * Old top-level loot. A record is selected when its `engagementId` maps to an imported engagement; when that is
 * absent or names no lab or standalone in the backup, its source machine decides. Placeholder secrets are never
 * stored. Duplicates keep the first record and move attempts and grants onto it.
 */
export function mapLoot(b: OldBackup, input: LootInput, skip: (reason: string) => void, now: number): LootPlan {
  const out: LootPlan = { credentials: [], usernames: [], accessGrants: [], credAttempts: [] };
  const hostEngagement = new Map(input.hosts.map((h) => [h.id, h.engagementId]));
  const logEngagement = new Map(input.logEntries.map((e) => [e.id, e.engagementId]));
  /** The imported engagement a record belongs to, null when not selected, "unassigned" when it names none. */
  const engagementFor = (r: Record<string, unknown>): string | null | "unassigned" => {
    if (hasText(r.engagementId)) {
      const e = input.engagementOf.get(r.engagementId) ?? hostEngagement.get(r.engagementId);
      if (e) return e;
      if (input.engagementIdsInBackup.has(r.engagementId)) return null;
    } else if (!hasText(r.sourceMachineId)) return "unassigned";
    return (hasText(r.sourceMachineId) && hostEngagement.get(r.sourceMachineId)) || null;
  };
  const hostIn = (engagementId: string, v: unknown): v is string => hasText(v) && hostEngagement.get(v) === engagementId;
  /** A host link in the engagement, else null; `dropped` says a link was given but is not imported. */
  const hostLink = (engagementId: string, v: unknown) => {
    const id = hostIn(engagementId, v) ? v : null;
    return { id, dropped: hasText(v) && id === null };
  };
  const logLink = (engagementId: string, v: unknown): string | null => {
    if (!hasText(v)) return null;
    if (logEngagement.get(v) === engagementId) return v;
    skip("droppedLogLink");
    return null;
  };
  const isImportedHost = (v: unknown) => hasText(v) && hostEngagement.has(v);

  // Credentials.
  const credIdMap = new Map<string, string>();
  const credScope = new Map<string, CredentialScope>();
  const skippedCreds = new Set<string>();
  const links = new Map<string, { crackedFrom: unknown; fromSecretId: unknown }>();
  type Verifications = { rawId: string; scope: CredentialScope; createdAt: number; raw: Record<string, unknown> };
  const verifications: Verifications[] = [];
  const redacted: (Verifications & { identity: string | null })[] = [];
  const kept: Credential[] = [];
  for (const raw of arr(b?.credentials)) {
    if (!isObj(raw)) {
      skip("badCredential");
      continue;
    }
    const engagementId = engagementFor(raw);
    if (engagementId === "unassigned") {
      skip("credUnassigned");
      continue;
    }
    if (!engagementId) continue;
    const id = optText(raw.id);
    if (!id || (typeof raw.username !== "string" && typeof raw.secret !== "string")) {
      skip("badCredential");
      continue;
    }
    const rawSecret = typeof raw.secret === "string" ? raw.secret : "";
    const type = oneOf<CredentialType>(CRED_TYPES, raw.type) ?? "other";
    const username = typeof raw.username === "string" ? raw.username.trim() : "";
    const scope = oneOf<CredentialScope>(SCOPES, raw.scope) ?? "domain";
    const createdAt = toMs(raw.createdAt, now);
    const verifs = isObj(raw.verifications) ? raw.verifications : null;
    if (raw.redacted === true || rawSecret.trim() === REDACTED) {
      skip("redactedCredential");
      skippedCreds.add(id);
      // Its attempts may still follow a real credential for the same principal (old mergeImportedLoot).
      redacted.push({ rawId: id, scope, createdAt, raw: verifs ?? {}, identity: identity({ engagementId, type, username, domain: optText(raw.domain) }) });
      continue;
    }
    const secret = type === "hash" ? rawSecret.trim() : stripLineBreaks(rawSecret);
    if (!username && !secret.trim()) {
      skip("badCredential");
      skippedCreds.add(id);
      continue;
    }
    let localHostId: string | null = null;
    if (scope === "local") {
      if (!hostIn(engagementId, raw.localHostId)) {
        skip("credLocalHostMissing");
        skippedCreds.add(id);
        continue;
      }
      localHostId = raw.localHostId;
    }
    const source = hostLink(engagementId, raw.sourceMachineId);
    const c: Credential = {
      id,
      engagementId,
      type,
      username,
      domain: optText(raw.domain),
      secret,
      hashType: type === "hash" ? (optText(raw.hashType) ?? defaultHashType(secret) ?? null) : null,
      scope,
      localHostId,
      sourceHostId: source.id,
      source: optText(raw.source),
      notes: optText(raw.notes),
      crackStatus: type === "hash" ? (oneOf<CrackStatus>(CRACK, raw.crackStatus) ?? "uncracked") : null,
      crackedFrom: null,
      fromSecretId: null,
      createdAt,
      updatedAt: createdAt,
    };
    const dup = findDuplicateCredential(kept, c);
    if (dup) {
      skip("credDuplicate");
      if (!credIdMap.has(id)) credIdMap.set(id, dup.id);
    } else {
      if (source.dropped) skip("droppedHostLink");
      kept.push(c);
      credIdMap.set(id, id);
      links.set(id, { crackedFrom: raw.crackedFrom, fromSecretId: raw.fromSecretId });
    }
    if (!credScope.has(id)) credScope.set(id, scope);
    if (verifs) verifications.push({ rawId: id, scope, createdAt, raw: verifs });
  }
  // A redacted credential's attempts and verifications go to a kept credential for the same principal.
  for (const r of redacted) {
    const twin = r.identity ? kept.find((c) => identity(c) === r.identity) : undefined;
    if (!twin || credIdMap.has(r.rawId)) continue;
    credIdMap.set(r.rawId, twin.id);
    if (!credScope.has(r.rawId)) credScope.set(r.rawId, r.scope);
    verifications.push(r);
  }
  // Credential links: only to an imported credential of the same engagement, never to itself or in a cycle.
  const byId = new Map(kept.map((c) => [c.id, c]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (c: Credential) => {
    state.set(c.id, "visiting");
    const raw = links.get(c.id)!;
    for (const field of ["crackedFrom", "fromSecretId"] as const) {
      if (!hasText(raw[field])) continue;
      const target = byId.get(credIdMap.get(raw[field]) ?? "");
      if (!target || target.id === c.id || target.engagementId !== c.engagementId || state.get(target.id) === "visiting") {
        skip("droppedCredLink");
        continue;
      }
      c[field] = target.id;
      if (!state.has(target.id)) visit(target);
    }
    state.set(c.id, "done");
    out.credentials.push(c);
  };
  for (const c of kept) if (!state.has(c.id)) visit(c);

  // Usernames, merged by id and then by usernameKey; access removed on any copy stays removed.
  const userIdMap = new Map<string, string>();
  const userByKey = new Map<string, Username>();
  const userById = new Map<string, Username>();
  const grantSources: { user: Username; access: unknown }[] = [];
  const deletedAccess = new Map<string, Set<string>>();
  for (const raw of arr(b?.usernames)) {
    if (!isObj(raw)) {
      skip("badUsername");
      continue;
    }
    const engagementId = engagementFor(raw);
    if (engagementId === "unassigned") {
      skip("usernameUnassigned");
      continue;
    }
    if (!engagementId) continue;
    const id = optText(raw.id);
    const name = optText(raw.username);
    if (!id || !name) {
      skip("badUsername");
      continue;
    }
    const source = hostLink(engagementId, raw.sourceMachineId);
    const u: Username = {
      id,
      engagementId,
      username: name,
      domain: optText(raw.domain),
      sourceHostId: source.id,
      source: optText(raw.source),
      createdAt: toMs(raw.createdAt, now),
    };
    const twin = userById.get(id) ?? userByKey.get(usernameKey(u));
    const target = twin ?? u;
    if (twin) skip("usernameDuplicate");
    else {
      if (source.dropped) skip("droppedHostLink");
      out.usernames.push(u);
      userById.set(id, u);
      userByKey.set(usernameKey(u), u);
    }
    if (!userIdMap.has(id)) userIdMap.set(id, target.id);
    const deleted = deletedAccess.get(target.id) ?? new Set<string>();
    for (const d of arr(raw.deletedAccessIds)) if (hasText(d)) deleted.add(d);
    deletedAccess.set(target.id, deleted);
    grantSources.push({ user: target, access: raw.access });
  }
  const grantIds = new Set<string>();
  for (const { user, access } of grantSources) {
    for (const g of arr(access)) {
      if (!isObj(g) || !hasText(g.id) || !oneOf<AccessLevel>(LEVELS, g.level)) {
        skip("badGrant");
        continue;
      }
      if (deletedAccess.get(user.id)!.has(g.id)) continue;
      if (!hostIn(user.engagementId, g.hostId)) {
        skip("grantHostMissing");
        continue;
      }
      if (grantIds.has(g.id)) {
        skip("duplicate");
        continue;
      }
      grantIds.add(g.id);
      out.accessGrants.push({
        id: g.id,
        engagementId: user.engagementId,
        usernameId: user.id,
        hostId: g.hostId,
        level: g.level as AccessLevel,
        via: hasText(g.via) ? g.via.trim() : VIA_NOT_RECORDED,
        logEntryId: logLink(user.engagementId, g.logEntryId),
        at: toMs(g.at, now),
      });
    }
  }

  // Attempts: explicit ones first, then legacy verifications; one per attemptKey, never downgraded.
  const attempts = new Map<string, CredAttempt>();
  const attemptIds = new Set<string>();
  const upsert = (a: CredAttempt) => {
    const key = attemptKey(a);
    const cur = attempts.get(key);
    if (!cur) {
      // An id already used by a different attempt gets a stable derived id rather than being lost.
      const id = attemptIds.has(a.id) ? `${a.id}:${key}` : a.id;
      if (attemptIds.has(id)) {
        skip("duplicate");
        return;
      }
      attemptIds.add(id);
      attempts.set(key, { ...a, id });
      return;
    }
    // Old upsertAttemptInList: a real result always beats a stored 'errored'; otherwise the later one wins,
    // and at the same instant the stronger one.
    const supersedesError = cur.result === "errored" && a.result !== "errored";
    if (!supersedesError && (a.at < cur.at || (a.at === cur.at && RESULT_RANK[a.result] < RESULT_RANK[cur.result]))) return;
    if (a.result === "errored" && cur.result !== "errored") {
      attempts.set(key, { ...cur, detail: a.detail ?? cur.detail, logEntryId: a.logEntryId ?? cur.logEntryId });
      return;
    }
    attempts.set(key, {
      ...cur,
      result: a.result,
      at: a.at,
      port: a.port ?? cur.port,
      detail: a.detail ?? cur.detail,
      logEntryId: a.logEntryId ?? cur.logEntryId,
    });
  };
  const keptCred = (rawId: string) => byId.get(credIdMap.get(rawId) ?? "");
  for (const raw of arr(b?.credAttempts)) {
    const credRaw = isObj(raw) ? optText(raw.credId) : null;
    const result = isObj(raw)
      ? (oneOf<AttemptResult>(RESULTS, raw.result) ?? (typeof raw.result === "string" ? LEGACY_RESULTS[raw.result] : undefined))
      : undefined;
    if (!isObj(raw) || !hasText(raw.id) || !credRaw || !hasText(raw.machineId) || !result) {
      skip("badAttempt");
      continue;
    }
    const c = keptCred(credRaw);
    if (!c) {
      // Only an attempt that belonged to this import is counted; others are simply not selected.
      if (skippedCreds.has(credRaw) || isImportedHost(raw.machineId)) skip("attemptCredMissing");
      continue;
    }
    if (!hostIn(c.engagementId, raw.machineId)) {
      skip("attemptHostMissing");
      continue;
    }
    let usernameId: string | null = null;
    if (hasText(raw.usernameId)) {
      const u = userById.get(userIdMap.get(raw.usernameId) ?? "");
      if (!u || u.engagementId !== c.engagementId) {
        skip("attemptUsernameMissing");
        continue;
      }
      usernameId = u.id;
    }
    const port = raw.port;
    upsert({
      id: raw.id.trim(),
      engagementId: c.engagementId,
      credId: c.id,
      usernameId,
      hostId: raw.machineId,
      service: oneOf<AttemptService>(SERVICES, raw.service) ?? "other",
      port: typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null,
      result,
      authMode: oneOf<AuthMode>(AUTH_MODES, raw.authMode) ?? (credScope.get(credRaw) === "local" ? "local" : "domain"),
      detail: optText(raw.detail),
      logEntryId: logLink(c.engagementId, raw.logEntryId),
      at: toMs(raw.at, now),
    });
  }
  for (const { rawId, scope, createdAt, raw } of verifications) {
    const c = keptCred(rawId);
    if (!c) continue;
    for (const [mid, v] of Object.entries(raw)) {
      const machineId = mid.trim();
      const result = isObj(v) && typeof v.status === "string" ? VERIFICATION_RESULTS[v.status] : undefined;
      if (!isObj(v) || !result || !machineId) continue;
      if (!hostIn(c.engagementId, machineId)) {
        skip("attemptHostMissing");
        continue;
      }
      upsert({
        id: `${rawId}:verification:${machineId}`,
        engagementId: c.engagementId,
        credId: c.id,
        usernameId: null,
        hostId: machineId,
        service: oneOf<AttemptService>(SERVICES, v.protocol) ?? "smb",
        port: null,
        result,
        authMode: scope === "local" ? "local" : "domain",
        detail: null,
        logEntryId: null,
        at: toMs(v.updatedAt, createdAt),
      });
    }
  }
  out.credAttempts.push(...attempts.values());
  return out;
}

/** Old `lootItems` grouped by their `machineId`; items without one are under "". */
export function lootItemsByMachine(b: OldBackup): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>();
  for (const it of arr(b?.lootItems)) {
    const key = isObj(it) && hasText(it.machineId) ? it.machineId.trim() : "";
    out.set(key, [...(out.get(key) ?? []), it]);
  }
  return out;
}

/**
 * Ruling T5-R4: a host's old loot items as a `## Loot` note section, one `- <category> · <title>: <value>`
 * line each (plus ` (<notes>)`). A multi-line value continues on indented lines so nothing is flattened.
 * Flag items already imported as the machine's flags are left out; placeholders are counted, never stored.
 * The caller escapes `? ` lines with the rest of the note.
 */
export function lootSection(m: OldMachine, items: unknown[], skip: (reason: string) => void): string {
  const flags = new Set([m.userFlag, m.rootFlag].filter(hasText).map((f) => f.trim()));
  const lines: string[] = [];
  for (const it of items) {
    if (!isObj(it)) {
      skip("badLoot");
      continue;
    }
    const category = oneOf<string>(LOOT_CATEGORIES, it.category) ?? "note";
    const title = hasText(it.title) ? oneLine(it.title) : "";
    const value = typeof it.value === "string" ? it.value.replace(/^\s*\n|\s+$/g, "").replace(/^[ \t]+/, "") : "";
    const notes = hasText(it.notes) ? oneLine(it.notes) : "";
    if (value.trim() === REDACTED) {
      skip("redactedLoot");
      continue;
    }
    if (category === "flag" && flags.has(value.trim())) continue;
    if (!title && !value.trim() && !notes) {
      skip("badLoot");
      continue;
    }
    const [first, ...rest] = value.split(/\r?\n/);
    const head = `- ${category}${title ? ` · ${title}` : ""}${first ? `: ${first}` : ""}${notes ? ` (${notes})` : ""}`;
    lines.push(head, ...rest.map((l) => (l ? `  ${l}` : "")));
  }
  return lines.length ? ["## Loot", ...lines].join("\n") : "";
}
