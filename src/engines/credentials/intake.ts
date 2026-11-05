import type { CredAttemptInput, Credential, CredentialInput, Username, UsernameInput } from "../../types/credentials";
import type { CommandBlock } from "../../types/log";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import { credKey, findDuplicateCredential, usernameKey } from "./keys";
import { isOwnerless } from "./matrix";
import { parseNxcAuthResults, parseRoastHashes, type NxcAuthResult } from "./nxc";
import type { CredAuthMode } from "./types";

/** Every planned record names its engagement (the one being planned for). */
export type PlannedCredential = CredentialInput & { engagementId: string };
export type PlannedUsername = UsernameInput & { engagementId: string };
type PlannedAttemptBase = CredAttemptInput & { engagementId: string };

/**
 * A planned attempt. A username-subject attempt for a username this same plan adds (not stored yet) carries
 * `usernameKey` (the usernameKey of that planned username) instead of `usernameId`; applyCredentialIntake
 * resolves it after adding the plan's usernames.
 */
export type PlannedAttempt = PlannedAttemptBase & { usernameKey?: string };

export interface PendingCredential {
  key: string;
  input: PlannedCredential;
  attempts: Omit<PlannedAttemptBase, 'credId'>[];
  /**
   * Set when the pair came from a username-list spray (spec decision 1 / R12): a listed (or planned) username
   * that worked with another credential's password. Accepting re-keys every attempt with that username and one
   * of `secretCredIds` onto the new credential (only on `hostId` for a local credential).
   */
  fromUsername?: { usernameId?: string; usernameKey?: string; secretCredIds: string[]; hostId?: string };
  /** What is recorded instead when the credential is not accepted: the same results, username-subject. */
  ifDeclined?: PlannedAttempt[];
  /**
   * Only [-] lines, and the secret matches no stored credential: shown so the drop is visible, added only when
   * the operator opts in (its results are otherwise unrecorded, and kept out of the summary counts).
   */
  failedOnly?: true;
}

export interface CredentialIntakePlan {
  attempts: PlannedAttempt[];
  /** Pairs with no matching credential: [+] pairs (offered), then failed-only pairs (opt-in, `failedOnly`). */
  newCredentials: PendingCredential[];
  /** Usernames seen in output, not yet listed. */
  newUsernames: PlannedUsername[];
  /** Roast hashes not already stored (dedupe by credKey). */
  newHashes: PlannedCredential[];
  /** Stored credentials a spray hit shows came from an owner-less secret; applied only where `fromSecretId` is unset. */
  links?: { credId: string; fromSecretId: string }[];
  /** IPs not among the engagement's hosts . */
  unknownHosts: string[];
  /** Hosts that answered on an IP Raven doesn't have (matched by the name nxc printed), e.g. after a lab revert. */
  ipChanges: { hostId: string; hostName: string; from: string; to: string }[];
  /** [-] lines whose secret matches no credential (each pair is also a failed-only newCredentials entry). */
  unrecorded: number;
  summary: { admin: number; valid: number; failed: number; errored: number };
}

const LOCAL_ONLY = new Set(['ssh', 'ftp', 'vnc', 'nfs']);
const HASH_RE = /^[0-9a-f]{32}(?::[0-9a-f]{32})?$/i;

/** Split a command into shell words: adjacent quoted/bare pieces, '\'' joins, backslash escapes. */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let cur = '';
  let inWord = false;
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      inWord = true;
      const end = command.indexOf("'", i + 1);
      const stop = end < 0 ? command.length : end;
      cur += command.slice(i + 1, stop);
      i = stop + 1;
    } else if (ch === '"') {
      inWord = true;
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1])) { cur += command[i + 1]; i += 2; }
        else if (command[i] === '\\' && command[i + 1] === '\n') i += 2;
        else cur += command[i++];
      }
      i++;
    } else if (ch === '\\') {
      if (i + 1 < command.length) {
        if (command[i + 1] !== '\n') { cur += command[i + 1]; inWord = true; }
        i += 2;
      } else i++;
    } else if (/\s/.test(ch)) {
      if (inWord) { words.push(cur); cur = ''; inWord = false; }
      i++;
    } else { cur += ch; inWord = true; i++; }
  }
  if (inWord) words.push(cur);
  return words;
}

const SECRET_FLAGS = ['-p', '-H', '--password', '--hash'];
const SHELL_OPERATOR = /^(?:\||\|\||&&?|;|[<>]|>>|\d>.*|&>.*)$/;

/**
 * Values of -p / -H (quoted or bare) in a command, used to disambiguate secrets that contain spaces or colons.
 * nxc takes several values per flag (`-p 'Welcome1' 'Welcome1!'`): every word after the flag is collected up to
 * the next option (a word starting with `-`) or shell operator. The first value is always taken.
 */
export function knownSecretsOf(command: string): string[] {
  const w = shellWords(command);
  const out: string[] = [];
  for (let i = 0; i < w.length - 1; i++) {
    if (!SECRET_FLAGS.includes(w[i])) continue;
    let j = i + 1;
    if (w[j]) out.push(w[j]);
    for (j++; j < w.length && !w[j].startsWith('-') && !SHELL_OPERATOR.test(w[j]); j++) if (w[j]) out.push(w[j]);
    i = j - 1;
  }
  return out;
}

const ntPart = (s: string): string => {
  const t = s.trim().toLowerCase();
  return /^[0-9a-f]{32}:[0-9a-f]{32}$/.test(t) ? t.slice(33) : t;
};

const RANK: Record<string, number> = { admin: 3, valid: 2, failed: 1, errored: 0 };

// Any host counts: a local credential tried elsewhere (--local-auth reuse or -d) is a result in its own grid cell.
function secretMatches(cred: Credential, secret: string): boolean {
  if (!cred.secret) return false;
  if (cred.type === 'hash') return HASH_RE.test(cred.secret.trim()) && ntPart(cred.secret) === ntPart(secret);
  if (cred.type === 'password') return cred.secret === secret;
  return false;
}

/**
 * A planned credential as a stored one, so the keys and `findDuplicateCredential` (the one dedupe rule) apply to
 * it. The id is synthetic and never stored.
 */
function asCredential(i: PlannedCredential, id: string): Credential {
  return {
    id, engagementId: i.engagementId, type: i.type, username: i.username ?? '', domain: i.domain ?? null,
    secret: i.secret ?? '', hashType: i.hashType ?? null, scope: i.scope ?? 'domain', localHostId: i.localHostId ?? null,
    sourceHostId: i.sourceHostId ?? null, source: i.source ?? null, notes: i.notes ?? null,
    crackStatus: i.crackStatus ?? null, crackedFrom: i.crackedFrom ?? null, fromSecretId: i.fromSecretId ?? null,
    createdAt: 0, updatedAt: 0,
  };
}

const lc = (s?: string): string => (s ?? '').trim().toLowerCase();

function usernameMatches(u: Username, username: string, domain?: string): boolean {
  if (lc(u.username) !== lc(username)) return false;
  return !u.domain || !domain || lc(u.domain) === lc(domain);
}

export function planCredentialIntake(input: {
  blocks: CommandBlock[];
  engagement: Pick<Engagement, 'id'>;
  hosts: Host[];
  credentials: Credential[];
  usernames: Username[];
}): CredentialIntakePlan | null {
  const { blocks, engagement, hosts } = input;
  const engCreds = input.credentials.filter(c => c.engagementId === engagement.id);
  const engUsernames = input.usernames.filter(u => u.engagementId === engagement.id);

  const hostByIp = new Map<string, Host>();
  for (const h of hosts) {
    if (h.ip && !hostByIp.has(h.ip)) hostByIp.set(h.ip, h);
  }

  const attemptMap = new Map<string, PlannedAttempt>();
  const pending = new Map<string, PendingCredential>();
  const pendingAttempts = new Map<string, Map<string, Omit<PlannedAttemptBase, 'credId'>>>();
  const declinedAttempts = new Map<string, Map<string, PlannedAttempt>>();
  const newUsernames = new Map<string, PlannedUsername>();
  const links = new Map<string, { credId: string; fromSecretId: string }>();
  const unknownHosts: string[] = [];
  const ipChanges: CredentialIntakePlan['ipChanges'] = [];
  // nxc prints the host's NetBIOS name; it identifies a known host whose IP changed.
  const hostByLabel = (label: string): Host | undefined => {
    const l = lc(label);
    if (!l || /^\d{1,3}(\.\d{1,3}){3}$/.test(l)) return undefined;
    const named = hosts.filter(h => { const n = lc(h.name); return n === l || n.split('.')[0] === l; });
    return named.length === 1 ? named[0] : undefined;
  };
  let unrecorded = 0;
  let sawAuth = false;

  /** R6: strongest result wins (admin > valid > failed > errored); equal strength keeps the later line. */
  const merge = <T extends { result: PlannedAttemptBase['result'] }>(m: Map<string, T>, key: string, a: T) => {
    const prior = m.get(key);
    if (!prior || RANK[a.result] >= RANK[prior.result]) m.set(key, a);
  };
  const ensurePending = (key: string, input: PlannedCredential): PendingCredential => {
    let p = pending.get(key);
    if (!p) {
      p = { key, input, attempts: [] };
      pending.set(key, p);
      pendingAttempts.set(key, new Map());
    }
    return p;
  };

  interface Unmatched { r: NxcAuthResult; hostId: string; authMode: CredAuthMode; base: Omit<PlannedAttemptBase, 'credId'>; key: string; credInput: PlannedCredential }
  const unmatched: Unmatched[] = [];
  // Non-success lines of a username-list spray: they follow the pending credential of their pair, if there is one.
  const deferred: { key: string; aKey: string; attempt: PlannedAttempt; base: Omit<PlannedAttemptBase, 'credId'>; hostId: string; authMode: CredAuthMode; protocol: string; port: number }[] = [];

  const credInputFor = (username: string, secret: string, r: NxcAuthResult, hostId: string, authMode: CredAuthMode, domain?: string): PlannedCredential => ({
    type: HASH_RE.test(secret) ? 'hash' : 'password', username, secret,
    ...(domain ? { domain } : {}),
    scope: authMode === 'local' ? 'local' : 'domain',
    ...(authMode === 'local' ? { localHostId: hostId } : {}),
    sourceHostId: hostId,
    source: `nxc ${r.protocol}`,
    engagementId: engagement.id,
  });
  // Local credentials are per-host; keep them apart even when username and secret coincide.
  const pendingKey = (input: PlannedCredential, authMode: CredAuthMode, hostId: string) =>
    credKey(asCredential(input, '')) + (authMode === 'local' ? `|local:${hostId}` : '');

  for (const block of blocks) {
    const results: NxcAuthResult[] = parseNxcAuthResults(block.output, knownSecretsOf(block.command));
    if (results.length) sawAuth = true;
    const localFlag = /--local-auth/.test(block.command);

    for (const r of results) {
      let host = hostByIp.get(r.ip);
      if (!host) {
        host = hostByLabel(r.hostLabel);
        if (host && !ipChanges.some(c => c.hostId === host!.id && c.to === r.ip)) {
          ipChanges.push({ hostId: host.id, hostName: host.name, from: host.ip ?? '', to: r.ip });
        }
      }
      if (!host) {
        if (!unknownHosts.includes(r.ip)) unknownHosts.push(r.ip);
        continue;
      }
      const authMode: CredAuthMode = localFlag || LOCAL_ONLY.has(r.protocol) ? 'local' : 'domain';
      const domain = authMode === 'local' ? undefined : r.domain;
      const base = {
        engagementId: engagement.id, hostId: host.id, service: r.protocol, port: r.port, result: r.result, authMode,
        ...(r.detail ? { detail: r.detail } : {}),
      };

      // Username seen in output but not yet listed: planned, and treated as listed for the rest of this plan.
      const listed = engUsernames.find(u => usernameMatches(u, r.username, domain));
      const nuKey = usernameKey({ engagementId: engagement.id, username: r.username, domain: domain ?? null });
      if (!listed && !newUsernames.has(nuKey)) {
        newUsernames.set(nuKey, {
          username: r.username, ...(domain ? { domain } : {}), engagementId: engagement.id,
          sourceHostId: host.id, source: 'nxc',
        });
      }

      const sameUser = engCreds.find(c => lc(c.username) === lc(r.username) && secretMatches(c, r.secret));
      if (sameUser) {
        // A hit while spraying an owner-less secret at this user: link the stored credential to it.
        if (!sameUser.fromSecretId && (r.result === 'admin' || r.result === 'valid')) {
          const owner = engCreds.find(c => isOwnerless(c) && secretMatches(c, r.secret));
          if (owner) links.set(sameUser.id, { credId: sameUser.id, fromSecretId: owner.id });
        }
        merge(attemptMap, `${sameUser.id}|${host.id}|${r.protocol}|${r.port}|${authMode}|`, { credId: sameUser.id, ...base });
        continue;
      }

      // Username-list spray: the password is known, the username is listed (or planned by this plan).
      const pwCred = engCreds.find(c => secretMatches(c, r.secret));
      if (pwCred) {
        const subject: { usernameId: string } | { usernameKey: string } = listed ? { usernameId: listed.id } : { usernameKey: nuKey };
        const subjectRef = listed ? listed.id : `key:${nuKey}`;
        const attempt: PlannedAttempt = { credId: pwCred.id, ...subject, ...base };
        const aKey = `${pwCred.id}|${host.id}|${r.protocol}|${r.port}|${authMode}|${subjectRef}`;
        // R12: a working pair is offered as a credential carrying its results.
        const username = listed?.username ?? r.username;
        const credDomain = authMode === 'local' ? undefined : (listed?.domain ?? domain);
        const input = credInputFor(username, r.secret, r, host.id, authMode, credDomain);
        const key = pendingKey(input, authMode, host.id);
        if (r.result !== 'admin' && r.result !== 'valid') {
          // Decided after the loop: it follows the pending credential if another line makes this pair one (T5-R1).
          deferred.push({ key, aKey, attempt, base, hostId: host.id, authMode, protocol: r.protocol, port: r.port });
          continue;
        }
        // A hit from an owner-less secret records where the user's credential came from.
        const ownerlessSecret = isOwnerless(pwCred) ? pwCred : engCreds.find(c => isOwnerless(c) && secretMatches(c, r.secret));
        if (ownerlessSecret) input.fromSecretId = ownerlessSecret.id;
        const p = ensurePending(key, input);
        const from = p.fromUsername ?? { ...subject, secretCredIds: [], ...(authMode === 'local' ? { hostId: host.id } : {}) };
        if (!from.secretCredIds.includes(pwCred.id)) from.secretCredIds.push(pwCred.id);
        p.fromUsername = from;
        merge(pendingAttempts.get(key)!, `${host.id}|${r.protocol}|${r.port}|${authMode}`, base);
        if (!declinedAttempts.has(key)) declinedAttempts.set(key, new Map());
        merge(declinedAttempts.get(key)!, aKey, attempt);
        continue;
      }

      const credInput = credInputFor(r.username, r.secret, r, host.id, authMode, domain);
      unmatched.push({ r, hostId: host.id, authMode, base, key: pendingKey(credInput, authMode, host.id), credInput });
    }
  }

  // Pairs with any [+] become pending credentials; every result line for them attaches (order independent).
  for (const u of unmatched) {
    if (u.r.result === 'admin' || u.r.result === 'valid') ensurePending(u.key, u.credInput);
  }
  // The rest only failed: still named, so the operator sees what was dropped and can keep it.
  const failedOnly = new Set<string>();
  for (const u of unmatched) {
    if (pending.has(u.key)) continue;
    ensurePending(u.key, u.credInput).failedOnly = true;
    failedOnly.add(u.key);
  }
  for (const u of unmatched) {
    if (failedOnly.has(u.key)) unrecorded++;
    merge(pendingAttempts.get(u.key)!, `${u.hostId}|${u.r.protocol}|${u.r.port}|${u.authMode}`, u.base);
  }
  for (const d of deferred) {
    if (pending.has(d.key)) {
      merge(pendingAttempts.get(d.key)!, `${d.hostId}|${d.protocol}|${d.port}|${d.authMode}`, d.base);
      if (!declinedAttempts.has(d.key)) declinedAttempts.set(d.key, new Map());
      merge(declinedAttempts.get(d.key)!, d.aKey, d.attempt);
    } else merge(attemptMap, d.aKey, d.attempt);
  }
  for (const [key, p] of pending) {
    p.attempts = [...pendingAttempts.get(key)!.values()];
    const declined = declinedAttempts.get(key);
    if (declined) p.ifDeclined = [...declined.values()];
  }

  const attempts = [...attemptMap.values()];
  const summary = { admin: 0, valid: 0, failed: 0, errored: 0 };
  for (const a of attempts) summary[a.result]++;
  for (const p of pending.values()) if (!p.failedOnly) for (const a of p.attempts) summary[a.result]++;

  // Roast hashes
  const seen = [...engCreds];
  const newHashes: PlannedCredential[] = [];
  for (const block of blocks) {
    for (const h of parseRoastHashes(block.output)) {
      const hashInput: PlannedCredential = {
        type: 'hash', username: h.username, secret: h.hash,
        ...(h.domain ? { domain: h.domain } : {}),
        source: 'nxc ldap roast', crackStatus: 'uncracked', engagementId: engagement.id,
      };
      const candidate = asCredential(hashInput, `planned:${newHashes.length}`);
      if (findDuplicateCredential(seen, candidate)) continue;
      seen.push(candidate);
      newHashes.push(hashInput);
    }
  }

  if (!sawAuth && newHashes.length === 0 && parseRoastHashes(blocks.map(b => b.output).join('\n')).length === 0) return null;

  return {
    attempts,
    newCredentials: [...pending.values()],
    newUsernames: [...newUsernames.values()],
    links: [...links.values()],
    newHashes,
    unknownHosts,
    ipChanges,
    unrecorded,
    summary,
  };
}

/** One-line summary: `nxc: 1 admin · 1 valid · 12 failed · 2 errored`, plus unknown hosts / unrecorded when non-zero. */
export function formatIntakeSummary(plan: CredentialIntakePlan): string {
  const { admin, valid, failed, errored } = plan.summary;
  const parts = [`nxc: ${admin} admin`, `${valid} valid`, `${failed} failed`, `${errored} errored`];
  if (plan.unknownHosts.length > 0) parts.push(`${plan.unknownHosts.length} unknown hosts`);
  if (plan.ipChanges.length > 0) parts.push(`${plan.ipChanges.length} host IP changed`);
  if (plan.unrecorded > 0) parts.push(`${plan.unrecorded} unrecorded`);
  return parts.join(' · ');
}

/**
 * Names a failed-only pair so the operator can tell same-named accounts apart: who, where, and which secret
 * ("a hash" or "a password": never any part of the secret).
 */
export function unrecordedLabel(p: PendingCredential, hosts: Pick<Host, 'id' | 'name' | 'ip'>[]): string {
  const ids = [...new Set(p.attempts.map((a) => a.hostId))];
  const where = ids.map((id) => { const h = hosts.find((x) => x.id === id); return h?.name || h?.ip || id; }).join(', ');
  // Never any part of the secret (T8-R2): the label is shown in the UI.
  const secret = p.input.type === 'hash' ? 'a hash' : 'a password';
  return `${pendingCredentialLabel(p)} with ${secret} on ${where}`;
}

/** `domain\user` label for a pending credential. */
export function pendingCredentialLabel(p: PendingCredential): string {
  return p.input.domain ? `${p.input.domain}\\${p.input.username ?? ''}` : (p.input.username ?? '');
}
