import { shellHost } from "../../engines/attribution";
import {
  AD_PLAYBOOKS,
  ENGAGEMENT_SETUP,
  engagementFacts,
  findDc,
  goalApplies,
  HOST_GOALS,
  hostFacts,
  LATERAL_MOVEMENT_GOALS,
  PIVOT_GOALS,
  type ChecklistGoal,
  type Tick,
} from "../../engines/checklist";
import {
  asCredential,
  findStoredCredential,
  identifyHash,
  ntHalf,
  planCredentialIntake,
  sameDomain,
  usernameKey,
  type CredentialIntakePlan,
  type PlannedAttempt,
} from "../../engines/credentials";
import { interpret } from "../../engines/interpret";
import { resolveInterpretation, type ResolvedInterpretation } from "../../engines/interpret/resolve";
import type { HostRef, Interpretation } from "../../engines/interpret/types";
import { api } from "../../lib/api";
import { shortHostName } from "../../lib/hostName";
import { ipInScope } from "../../engines/parse/scope";
import type { AttemptService, CredAttempt, Credential, TriedPair, TriedPairInput, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { HostIdentity, PrivescVector } from "../../types/hostFacts";
import type { ExtractionRecord, ExtractionSummary, LogEntry, OutputTick } from "../../types/log";
import type { Service } from "../../types/service";
import { byOwnerOf } from "../checklist/state";
import { loadTickContext, outputTicksOf } from "../checklist/ticks";
import { applyIntake } from "../credentials/applyIntake";
import { RavenError } from "../../types/errors";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** An impacket target (`corp.lan/jay:pw@10.10.1.5`): the host the dump came from, whatever the shell. */
const IMPACKET_TARGET = /@(\d{1,3}(?:\.\d{1,3}){3})(?=\s|$)/;

export const NOTHING_NEW: ExtractionSummary = { wins: [], counts: ["Nothing new: already recorded"], ticks: [] };

export const emptyRecord = (): ExtractionRecord => ({
  createdHostIds: [], createdServiceIds: [], servicesBefore: [], hostOsBefore: [], identityBefore: [],
  createdCredentialIds: [], credentialsBefore: [], createdUsernameIds: [], createdAttemptIds: [], attemptsBefore: [],
  createdTriedPairIds: [], createdVectorIds: [], outputTicks: [], reprovedCredentialIds: [], reprovedUsernameIds: [],
});

/** Swaps every host reference the `swap` function rewrites; other references stay. */
function mapHosts(i: Interpretation, swap: (h: HostRef) => HostRef): Interpretation {
  const one = <T extends { host: HostRef | null }>(x: T): T => (x.host ? { ...x, host: swap(x.host) } : x);
  return {
    ...i,
    credentials: i.credentials.map(one),
    attempts: i.attempts.map((a) => ({ ...a, host: swap(a.host) })),
    usernames: i.usernames.map(one),
    vectors: i.vectors.map((v) => ({ ...v, host: swap(v.host) })),
    ticks: i.ticks.map((t) => (t.host === "engagement" ? t : { ...t, host: swap(t.host) })),
  };
}

/** The nxc IP changes (a known host answering on a new IP, matched by the name nxc printed), from the output alone. */
function ipChangesOf(entry: LogEntry, hosts: Host[]): CredentialIntakePlan["ipChanges"] {
  if (entry.content.kind !== "command") return [];
  const plan = planCredentialIntake({ blocks: entry.content.blocks, engagement: { id: entry.engagementId }, hosts, credentials: [], usernames: [] });
  return plan?.ipChanges ?? [];
}

/** A resolved interpretation, with the results dropped because their IP is outside the engagement's scope. */
export type PlacedInterpretation = ResolvedInterpretation & { outOfScope: number };

/** `--format=nt` / `--format nt` of a john command, lowercased. */
const JOHN_FORMAT = /\bjohn\b.*?--format[= ](\S+)/i;

/**
 * Interprets each command block of a saved entry and places what it found on hosts. A block's "ran on" host is the
 * host its shell names, else the entry's first tagged host; an impacket `@<ip>` target names the dumped host instead.
 * An nxc IP change is placed on the known host (as the nxc intake does), so it never makes a new host. With a scope
 * set, an unknown IP outside it is never a new host: its results are dropped and counted (`outOfScope`, R23).
 */
export function interpretEntry(entry: LogEntry, hosts: Host[], domain = "", scope: string[] = []): PlacedInterpretation {
  const out: PlacedInterpretation = {
    parsers: [], newIps: [], credentials: [], attempts: [], cracks: [], usernames: [], vectors: [], ticks: [], droppedUnknown: 0,
    outOfScope: 0,
  };
  if (entry.content.kind !== "command") return out;
  const moved = new Map(ipChangesOf(entry, hosts).map((c) => [c.to, c.hostId]));
  const refs = hosts.map((h) => ({ id: h.id, name: h.name, ip: h.ip }));
  for (const block of entry.content.blocks) {
    let found = interpret({ command: block.command ?? "", output: block.output ?? "" });
    if (found.parsers.length === 0) continue;
    const target = IMPACKET_TARGET.exec(block.command ?? "")?.[1];
    found = mapHosts(found, (h) => {
      if ("ranOn" in h && target) h = { ip: target };
      if ("ip" in h && moved.has(h.ip)) return { hostId: moved.get(h.ip)! };
      return h;
    });
    const shell = shellHost(block.shell, entry.ranOn ?? undefined, refs, domain);
    const ranOn = shell?.id ?? entry.hostIds[0];
    const r = resolveInterpretation(found, { entryHostIds: ranOn ? [ranOn] : [], hosts });
    const outside = new Set(scope.length ? r.newIps.filter((ip) => !ipInScope(ip, scope)) : []);
    const inScope = <T extends object>(items: T[], counted: boolean): T[] =>
      items.filter((x) => {
        const drop = "newIp" in x && outside.has(x.newIp as string);
        if (drop && counted) out.outOfScope++;
        return !drop;
      });
    for (const p of r.parsers) if (!out.parsers.includes(p)) out.parsers.push(p);
    for (const ip of r.newIps) if (!outside.has(ip) && !out.newIps.includes(ip)) out.newIps.push(ip);
    out.credentials.push(...inScope(r.credentials, true));
    out.attempts.push(...inScope(r.attempts, true));
    const format = JOHN_FORMAT.exec(block.command ?? "")?.[1]?.toLowerCase();
    out.cracks.push(...r.cracks.map((k) => (format ? { ...k, format } : k)));
    out.usernames.push(...inScope(r.usernames, true));
    out.vectors.push(...inScope(r.vectors, true));
    out.ticks.push(...inScope(r.ticks, false));
    out.droppedUnknown += r.droppedUnknown;
  }
  return out;
}

/** What saveCapture filed itself before the interpretation: a scan-proven host, the scan and the identity. */
export interface FiledBySave {
  /** The engagement's hosts as saved (including any created below). */
  hosts: Host[];
  /** Hosts this save created for a scan of an unknown IP. */
  createdHostIds: string[];
  scans: {
    hostId: string;
    createdServiceIds: string[];
    servicesBefore: Service[];
    /** Set when the scan filled the host's OS. */
    hostOsBefore: { hostId: string; os: null } | null;
  }[];
  identity: {
    hostId: string;
    before: HostIdentity | null;
    /** Whether the stored identity changed. */
    changed: boolean;
    /** Privesc vector titles the identity points to. */
    vectors: string[];
  } | null;
}

export interface Applied {
  /** Null when nothing parsed at all: no extraction is stored. */
  summary: ExtractionSummary | null;
  record: ExtractionRecord;
  /** The record's output ticks as checklist ticks of the entry. */
  outputTicks: Tick[];
}

/** Filing failed part-way; `applied` is what was filed before it failed. */
export class ExtractionError extends Error {
  readonly reason: unknown;
  readonly applied: Applied;
  constructor(reason: unknown, applied: Applied) {
    super(RavenError.from(reason).message);
    this.name = "ExtractionError";
    this.reason = reason;
    this.applied = applied;
  }
}

const GOALS = new Map<string, ChecklistGoal>(
  [...HOST_GOALS, ...PIVOT_GOALS, ...ENGAGEMENT_SETUP, ...LATERAL_MOVEMENT_GOALS, ...AD_PLAYBOOKS.flatMap((p) => p.goals)].map((g) => [g.id, g]),
);
const HOST_GOAL_IDS = new Set([...HOST_GOALS, ...PIVOT_GOALS].map((g) => g.id));

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ntOf = (s: string): string => ntHalf(s).toLowerCase();
const isMachine = (username: string) => username.trim().endsWith("$");
const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Whether john's `--format` names this hash credential's type (by its stored type, or by the hash's shape). */
function isJohnFormat(c: Credential, format: string): boolean {
  const f = format.toLowerCase();
  if (f === "nt" && /ntlm|pwdump/i.test(c.hashType ?? "")) return true;
  if (f === "mscash2" && /dcc2|mscash2/i.test(c.hashType ?? "")) return true;
  return identifyHash(c.secret).some((h) => h.johnFormat?.toLowerCase() === f);
}

interface Lists {
  credentials: Credential[];
  usernames: Username[];
  attempts: CredAttempt[];
  triedPairs: TriedPair[];
}

const listAll = async (engagementId: string): Promise<Lists> => {
  const [credentials, usernames, attempts, triedPairs] = await Promise.all([
    api.credentialsList(engagementId),
    api.usernamesList(engagementId),
    api.credAttemptsList(engagementId),
    api.triedPairsList(engagementId),
  ]);
  return { credentials: credentials ?? [], usernames: usernames ?? [], attempts: attempts ?? [], triedPairs: triedPairs ?? [] };
};

/**
 * Files what a saved entry's output proved (interpreters-and-payloads interpreters-and-payloads spec §3.1), after saveCapture filed the scan and identity (`filed`):
 *  1. hosts for the new IPs (only IPs the output proved);
 *  2. dumped credentials (deduped; `$MACHINE.ACC` named after its host), cracks, and usernames;
 *  3. the nxc results through the nxc intake: every working pair becomes a credential; a failed pair whose secret is
 *     no stored credential becomes a tried pair; roast hashes are added;
 *  4. privesc vectors (the output's and the identity's);
 *  5. every credential this save created promotes its tried pair.
 * Created rows and "before" snapshots are found by comparing the lists before and after, so the record lists
 * exactly what this save changed. Throws `ExtractionError` carrying what was filed when a step fails.
 */
export async function applyInterpretation(
  engagementId: string,
  entry: LogEntry,
  r: ResolvedInterpretation & { outOfScope?: number },
  filed: FiledBySave,
): Promise<Applied> {
  const record = emptyRecord();
  record.createdHostIds.push(...filed.createdHostIds);
  for (const scan of filed.scans) {
    record.createdServiceIds.push(...scan.createdServiceIds);
    record.servicesBefore.push(...scan.servicesBefore);
    if (scan.hostOsBefore) record.hostOsBefore.push(scan.hostOsBefore);
  }
  if (filed.identity?.changed) record.identityBefore.push({ hostId: filed.identity.hostId, identity: filed.identity.before });

  const hosts = [...filed.hosts];
  const hostName = (id: string | null | undefined) => {
    const h = hosts.find((x) => x.id === id);
    return h?.name || h?.ip || "";
  };
  const ipToId = new Map<string, string>();
  const placed = (p: { hostId: string | null } | { newIp: string }): string | null =>
    "newIp" in p ? (ipToId.get(p.newIp) ?? null) : p.hostId;
  const blocks = entry.content.kind === "command" ? entry.content.blocks : [];
  let plan: CredentialIntakePlan | null = null;
  const crackWins: string[] = [];
  const vectorWins: string[] = [];
  let before: Lists | null = null;
  let after: Lists | null = null;
  let failure: { e: unknown } | null = null;
  // The credentials as this save left them (stored ones, plus what it created or cracked).
  let creds: Credential[] = [];
  let noteCredential: (c: Credential | undefined) => void = () => {};
  let noteChanged: (id: string) => void = () => {};
  let noteTried: (rows: TriedPair[]) => void = () => {};
  let noteUsername: (u: Username | undefined) => void = () => {};
  let noteAttempts: (rows: CredAttempt[]) => void = () => {};
  /** A row stored before this save that its output proved again (interpreters-and-payloads spec §3.2: another entry's Undo keeps it). */
  const noteReproved = (ids: string[], id: string, stored: { id: string }[]) => {
    if (stored.some((x) => x.id === id) && !ids.includes(id)) ids.push(id);
  };

  try {
    // 1. Hosts for the IPs the output proved. A retry finds the host already made.
    for (const ip of r.newIps) {
      let h = hosts.find((x) => x.ip === ip);
      if (!h) {
        h = await api.hostCreate(engagementId, { name: ip, ip });
        hosts.push(h);
        record.createdHostIds.push(h.id);
      }
      ipToId.set(ip, h.id);
    }

    before = await listAll(engagementId);
    const was = before;
    creds = [...before.credentials];
    // What each step files is recorded from what the store returns, so a failed read afterwards still leaves an
    // exact record; the list diff below only adds what applyIntake filed.
    noteCredential = (c) => {
      if (!c) return;
      const i = creds.findIndex((x) => x.id === c.id);
      if (i < 0) creds.push(c);
      else creds[i] = c;
      const old = was.credentials.find((x) => x.id === c.id);
      if (!old) {
        if (!record.createdCredentialIds.includes(c.id)) record.createdCredentialIds.push(c.id);
      } else if (JSON.stringify(old) !== JSON.stringify(c)) noteChanged(c.id);
    };
    noteChanged = (id) => {
      const old = was.credentials.find((x) => x.id === id);
      if (old && !record.credentialsBefore.some((x) => x.id === id)) record.credentialsBefore.push(old);
    };
    noteUsername = (u) => {
      if (u && !was.usernames.some((x) => x.id === u.id) && !record.createdUsernameIds.includes(u.id)) record.createdUsernameIds.push(u.id);
    };
    noteAttempts = (rows) => {
      for (const a of rows) {
        const old = was.attempts.find((x) => x.id === a.id);
        if (!old) {
          if (!record.createdAttemptIds.includes(a.id)) record.createdAttemptIds.push(a.id);
        } else if (JSON.stringify(old) !== JSON.stringify(a) && !record.attemptsBefore.some((x) => x.id === a.id)) {
          record.attemptsBefore.push(old);
        }
      }
    };
    noteTried = (rows) => {
      for (const t of rows) {
        if (!was.triedPairs.some((x) => x.id === t.id) && !record.createdTriedPairIds.includes(t.id)) record.createdTriedPairIds.push(t.id);
      }
    };

    // 2a. Dumped credentials.
    for (const c of r.credentials) {
      const hostId = placed(c);
      let username = c.username;
      if (username === "$MACHINE.ACC") {
        // R6: the dumped host's own account, named after the host; dropped when the host's name isn't known.
        const name = hostName(hostId);
        if (!hostId || !name || IPV4.test(name)) continue;
        username = `${shortHostName(name).toUpperCase()}$`;
      }
      if (c.scope === "local" && !hostId) continue;
      const candidate = asCredential({
        engagementId, type: c.type, username, domain: c.domain, secret: c.secret, hashType: c.hashType,
        scope: c.scope, localHostId: c.scope === "local" ? hostId : null, sourceHostId: hostId, source: c.source,
      });
      const stored = findStoredCredential(creds, candidate);
      if (stored) {
        noteReproved(record.reprovedCredentialIds, stored.id, before.credentials);
        continue;
      }
      const created = await api.credentialCreate(engagementId, {
        type: c.type, username, domain: c.domain, secret: c.secret, hashType: c.hashType, scope: c.scope,
        localHostId: candidate.localHostId, sourceHostId: hostId, source: c.source,
      });
      noteCredential(created);
    }

    // 2b. Cracks: every stored hash with that value, or (john `user:password`) the only hash of that user, of the
    // command's --format when it names one.
    for (const k of r.cracks) {
      const hashes = creds.filter((c) => c.type === "hash");
      // john prints the user as in the input file, so a `DOMAIN/user` or `DOMAIN\user` prefix names the domain too.
      const prefixed = /^([^/\\]+)[/\\](.+)$/.exec((k.username ?? "").trim());
      const user = (prefixed ? prefixed[2]! : (k.username ?? "")).trim().toLowerCase();
      const userDomain = prefixed ? prefixed[1]!.trim() : null;
      const match = k.hash
        ? hashes.filter((c) => c.secret.trim().toLowerCase() === k.hash.trim().toLowerCase() || ntOf(c.secret) === ntOf(k.hash))
        : user
          ? hashes.filter((c) => c.username.trim().toLowerCase() === user && (!userDomain || sameDomain(c.domain, userDomain)) && (!k.format || isJohnFormat(c, k.format)))
          : [];
      if (!k.hash && match.length !== 1) continue;
      for (const hash of match) {
        if (hash.crackStatus === "cracked") {
          // Cracked before: this output proves the hash and its password again.
          noteReproved(record.reprovedCredentialIds, hash.id, before.credentials);
          for (const pw of creds) if (pw.crackedFrom === hash.id) noteReproved(record.reprovedCredentialIds, pw.id, before.credentials);
          continue;
        }
        const pw = await api.credentialCrack(hash.id, k.plaintext);
        // The hash is now marked cracked: snapshot it as it was.
        noteChanged(hash.id);
        noteCredential(pw);
        crackWins.push(`${hash.username || "(no user)"}:${k.plaintext} cracked`);
      }
    }

    // 2c. Usernames, unless already listed (R16: CORP and corp.lan are one domain).
    const listedUsers = [...before.usernames];
    for (const u of r.usernames) {
      const known = listedUsers.find(
        (x) => x.username.trim().toLowerCase() === u.username.trim().toLowerCase() && (!x.domain || !u.domain || sameDomain(x.domain, u.domain)),
      );
      if (known) {
        noteReproved(record.reprovedUsernameIds, known.id, before.usernames);
        continue;
      }
      const created = await api.usernameCreate(engagementId, { username: u.username, domain: u.domain, sourceHostId: placed(u), source: u.source });
      noteUsername(created);
      listedUsers.push(created);
    }

    // 3. nxc results and roast hashes, planned against the hosts as they are now (new IPs included).
    let planCreds: Credential[] = [];
    let planUsers: Username[] = [];
    if (blocks.length) {
      const [c, u] = await Promise.all([api.credentialsList(engagementId), api.usernamesList(engagementId)]);
      planCreds = c ?? [];
      planUsers = u ?? [];
      plan = planCredentialIntake({ blocks, engagement: { id: engagementId }, hosts, credentials: planCreds, usernames: planUsers });
    }
    if (plan) {
      // A failed username-spray line already kept as a tried pair (the secret wasn't stored then) isn't filed twice.
      const pairs = before.triedPairs;
      const planned = plan.newUsernames;
      const usernameOf = (a: PlannedAttempt) =>
        a.usernameId
          ? planUsers.find((u) => u.id === a.usernameId)
          : planned.find((u) => usernameKey({ ...u, domain: u.domain ?? null }) === a.usernameKey);
      plan = {
        ...plan,
        attempts: plan.attempts.filter((a) => {
          if ((!a.usernameId && !a.usernameKey) || (a.result !== "failed" && a.result !== "errored")) return true;
          const u = usernameOf(a);
          const secret = planCreds.find((c) => c.id === a.credId)?.secret;
          return !pairs.some(
            (t) => !!u && lc(t.username) === lc(u.username) && sameDomain(t.domain, u.domain) && t.secret === secret &&
              t.hostId === a.hostId && t.service === a.service && t.authMode === (a.authMode ?? "domain"),
          );
        }),
      };
      // Stored rows the plan matched instead of adding (a re-roasted hash, a listed username): another entry's Undo keeps them.
      for (const id of plan.reproved.credentialIds) noteReproved(record.reprovedCredentialIds, id, before.credentials);
      for (const id of plan.reproved.usernameIds) noteReproved(record.reprovedUsernameIds, id, before.usernames);
      const storedBefore = before.credentials;
      const acceptKeys = plan.newCredentials.filter((p) => !p.failedOnly).map((p) => p.key);
      await applyIntake(engagementId, plan, {
        logEntryId: entry.id, at: entry.at, acceptKeys,
        onFiled: {
          credential: noteCredential, username: noteUsername, attempts: noteAttempts,
          // noteReproved counts only rows stored before this save.
          reused: (id) => noteReproved(record.reprovedCredentialIds, id, storedBefore),
        },
      });
      // Failed pairs with an unknown secret are never credentials: they are tried pairs.
      const tried: TriedPairInput[] = [];
      for (const p of plan.newCredentials) {
        if (!p.failedOnly || !p.input.username || !p.input.secret) continue;
        for (const a of p.attempts) {
          if (a.result !== "failed") continue;
          tried.push({
            username: p.input.username, domain: p.input.domain ?? null, secret: p.input.secret,
            secretKind: p.input.type === "hash" ? "hash" : "password", hostId: a.hostId, service: a.service,
            authMode: a.authMode ?? "domain", logEntryId: entry.id, at: entry.at,
          });
        }
      }
      if (tried.length) noteTried((await api.triedPairsUpsert(engagementId, tried)) ?? []);
    }

    // 4. Privesc vectors: the identity's and the output's.
    const wanted: { hostId: string; title: string }[] = [];
    if (filed.identity) for (const title of filed.identity.vectors) wanted.push({ hostId: filed.identity.hostId, title });
    for (const v of r.vectors) {
      const hostId = placed(v);
      if (hostId) wanted.push({ hostId, title: v.title });
    }
    const vectorsBefore = new Map<string, PrivescVector[]>();
    for (const { hostId, title } of wanted) {
      if (!vectorsBefore.has(hostId)) vectorsBefore.set(hostId, (await api.vectorsList(hostId)) ?? []);
      const v = await api.vectorUpsert(hostId, { title, status: "try", source: "auto" });
      const known = vectorsBefore.get(hostId)!;
      if (!v || known.some((x) => x.id === v.id) || record.createdVectorIds.includes(v.id)) continue;
      record.createdVectorIds.push(v.id);
      vectorWins.push(`${title} on ${hostName(hostId)}`);
    }
  } catch (e) {
    failure = { e };
  }

  // 5. What applyIntake filed (and anything else the steps above didn't return), by comparing the lists.
  if (before) {
    try {
      after = await listAll(engagementId);
      for (const c of after.credentials) noteCredential(c);
      for (const u of after.usernames) noteUsername(u);
      noteAttempts(after.attempts);
      noteTried(after.triedPairs);
    } catch (e) {
      failure ??= { e };
    }

    // 6. Each credential this save created takes over its tried pairs (R24): their failures are kept as failed
    // attempts on it (with their own proof and time), then the pairs go.
    try {
      const pairs = after?.triedPairs ?? (await api.triedPairsList(engagementId)) ?? [];
      const known = after?.credentials ?? creds;
      for (const id of record.createdCredentialIds) {
        const c = known.find((x) => x.id === id);
        if (!c) continue;
        const matching = pairs.filter(
          (t) => lc(t.username) === lc(c.username) && sameDomain(t.domain, c.domain) && t.secret === c.secret,
        );
        if (matching.length) {
          const rows = await api.credAttemptsUpsert(
            engagementId,
            matching.map((t) => ({
              credId: c.id, hostId: t.hostId, service: t.service as AttemptService, result: "failed" as const, authMode: t.authMode,
              logEntryId: t.logEntryId, at: t.at,
            })),
          );
          noteAttempts(rows ?? []);
        }
        await api.triedPairPromote(engagementId, c.username, c.domain, c.secret);
      }
    } catch (e) {
      failure ??= { e };
    }
  }

  // Output ticks: only on goals that apply to their owner; a goal not yet done gets a summary line.
  const tickLines: string[] = [];
  let dcNames = new Set<string>();
  try {
    const ctx = await loadTickContext(engagementId);
    const dc = findDc(ctx.hosts, ctx.servicesByHost);
    dcNames = new Set(dc ? [shortHostName(dc.name).toLowerCase()] : []);
    // Only for the summary wording ("Ticked …" for a goal not done yet): a failed read lists every tick.
    const state = byOwnerOf((await api.checklistList(engagementId).catch(() => [])) ?? []);
    const seen = new Set<string>();
    for (const t of r.ticks) {
      const goal = GOALS.get(t.goalId);
      if (!goal) continue;
      const hostId = placed(t);
      if ("newIp" in t && !hostId) continue;
      const isHostGoal = HOST_GOAL_IDS.has(t.goalId);
      const host = hostId ? ctx.hosts.find((h) => h.id === hostId) : undefined;
      if (isHostGoal !== !!hostId || (hostId && !host)) continue;
      const applies = host
        ? goalApplies(goal, hostFacts(host, ctx.engagement, ctx.hosts, ctx.servicesByHost))
        : goalApplies(goal, engagementFacts(ctx.engagement, ctx.hosts));
      const ownerId = hostId ?? engagementId;
      const key = `${ownerId}\u0000${t.goalId}`;
      if (!applies || seen.has(key)) continue;
      seen.add(key);
      const tick: OutputTick = { ownerId, goalId: t.goalId, parser: t.parser };
      record.outputTicks.push(tick);
      if (state.get(ownerId)?.[t.goalId]?.status !== "done") {
        tickLines.push(`Ticked '${goal.title}' on ${host ? host.name : ctx.engagement.name}`);
      }
    }
  } catch (e) {
    failure ??= { e };
  }

  const summary = summarize({ entry, r, filed, record, before, after, creds, plan, hostName, dcNames, crackWins, vectorWins, tickLines });
  const applied: Applied = { summary, record, outputTicks: outputTicksOf(entry.id, record.outputTicks) };
  if (failure) throw new ExtractionError(failure.e, applied);
  return applied;
}

function summarize(x: {
  entry: LogEntry;
  r: ResolvedInterpretation & { outOfScope?: number };
  filed: FiledBySave;
  record: ExtractionRecord;
  before: Lists | null;
  after: Lists | null;
  /** The credentials as the filing steps left them; used when the read afterwards failed. */
  creds: Credential[];
  plan: CredentialIntakePlan | null;
  hostName: (id: string | null | undefined) => string;
  dcNames: Set<string>;
  crackWins: string[];
  vectorWins: string[];
  tickLines: string[];
}): ExtractionSummary | null {
  const { r, filed, record, before, after, plan, hostName, dcNames } = x;
  const parsed = r.parsers.length > 0 || plan !== null || filed.scans.length > 0 || filed.identity !== null;
  if (!parsed) return null;

  const wins: string[] = [];
  const counts: string[] = [];
  const credById = new Map((after?.credentials ?? x.creds).map((c) => [c.id, c]));
  const created = record.createdCredentialIds.map((id) => credById.get(id)).filter((c): c is Credential => !!c);

  // Attempts this save added or whose result it changed (a re-paste only re-dates them).
  const wasAttempt = new Map((before?.attempts ?? []).map((a) => [a.id, a]));
  const changed = (after?.attempts ?? []).filter((a) => {
    const old = wasAttempt.get(a.id);
    return !old || old.result !== a.result;
  });
  const winCredIds = new Set<string>();
  for (const a of changed) {
    if (a.result !== "valid" && a.result !== "admin") continue;
    const c = credById.get(a.credId);
    if (!c || a.usernameId) continue;
    winCredIds.add(c.id);
    const shown = c.type === "hash" ? "NT hash" : c.secret;
    const line = `${c.username}:${shown} works on ${a.service.toUpperCase()}, ${hostName(a.hostId)}${a.result === "admin" ? " (admin)" : ""}`;
    if (!wins.includes(line)) wins.push(line);
  }
  // A machine account's hash; its cleartext (an LSA secret) is counted on its own.
  const machines = created.filter((c) => isMachine(c.username) && c.type === "hash");
  const machinePasswords = created.filter((c) => isMachine(c.username) && c.type !== "hash").length;
  for (const c of machines) {
    if (dcNames.has(c.username.trim().slice(0, -1).toLowerCase())) wins.push(`${c.username.trim()} hash: can DCSync`);
  }
  wins.push(...x.vectorWins, ...x.crackWins);

  const otherMachines = machines.filter((c) => !dcNames.has(c.username.trim().slice(0, -1).toLowerCase())).length;
  const failed = changed.filter((a) => a.result === "failed").length + record.createdTriedPairIds.length;
  const hashes = created.filter((c) => c.type === "hash" && !isMachine(c.username)).length;
  const passwords = created.filter(
    (c) => c.type === "password" && !isMachine(c.username) && !winCredIds.has(c.id) && !c.crackedFrom,
  ).length;

  for (const id of record.createdHostIds) counts.push(`New host ${hostName(id)}`);
  if (failed) counts.push(`${plural(failed, "failed attempt", "failed attempts")} recorded`);
  if (record.createdUsernameIds.length) counts.push(`${plural(record.createdUsernameIds.length, "username", "usernames")} added`);
  if (hashes) counts.push(`${plural(hashes, "hash", "hashes")} added`);
  if (otherMachines) counts.push(`${plural(otherMachines, "machine account hash", "machine account hashes")} added`);
  if (machinePasswords) counts.push(`${plural(machinePasswords, "machine account credential", "machine account credentials")} added`);
  if (passwords) counts.push(`${plural(passwords, "password", "passwords")} added`);
  for (const scan of filed.scans) {
    const services = scan.createdServiceIds.length + scan.servicesBefore.length;
    if (services) counts.push(`${plural(services, "service", "services")} updated on ${hostName(scan.hostId)}`);
    if (scan.hostOsBefore) counts.push(`OS set on ${hostName(scan.hostId)}`);
  }
  if (filed.identity?.changed) counts.push(`Identity updated on ${hostName(filed.identity.hostId)}`);
  // News even when nothing was filed: results Raven kept out, and a host that moved.
  if (r.droppedUnknown) counts.push(`${plural(r.droppedUnknown, "result", "results")} on hosts not in this engagement`);
  if (r.outOfScope) counts.push(`${plural(r.outOfScope, "result", "results")} outside this engagement's scope`);
  for (const c of plan?.ipChanges ?? []) counts.push(`${c.hostName} answered on ${c.to}`);

  const somethingNew =
    wins.length > 0 || counts.length > 0 || x.tickLines.length > 0 || record.credentialsBefore.length > 0 || changed.length > 0;
  if (!somethingNew) return NOTHING_NEW;
  return { wins, counts, ticks: x.tickLines };
}
