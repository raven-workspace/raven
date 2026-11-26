import { shellHost } from "../../engines/attribution";
import { OPEN_STATES, type CaptureDraft } from "../../engines/capture";
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
} from "../../engines/checklist";
import {
  defaultHashType,
  identifyHash,
  isReuseAttempt,
  ntHalf,
  planCredentialIntake,
  plannedUsernameKey,
  reuseWording,
  type CredentialIntakePlan,
  type PlannedAttempt,
} from "../../engines/credentials";
import { identityBlocksOf, isIdentityBlockFor, mergeIdentity, usableIdentity, vectorsFromIdentity, type IdentityFields } from "../../engines/facts";
import { interpret } from "../../engines/interpret";
import { resolveInterpretation, type Placement, type ResolvedInterpretation } from "../../engines/interpret/resolve";
import type { HostRef, Interpretation } from "../../engines/interpret/types";
import { ipInScope } from "../../engines/parse/scope";
import { api } from "../../lib/api";
import { shortHostName } from "../../lib/hostName";
import type { Credential, CredentialInput, DomainPair, TriedPairInput } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { ExtractionProofs, ExtractionSummary, Filed, IntakeProof, LogEntry, OutputTick, PlannedAttemptProof } from "../../types/log";
import { byOwnerOf } from "../checklist/state";
import { loadTickContext } from "../checklist/ticks";

// What an output proves (the proofs the store files, `extraction_file`), and the summary of what the store filed.

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** An impacket target (`corp.lan/zoe:pw@10.10.1.5`): the host the dump came from, whatever the shell. */
const IMPACKET_TARGET = /@(\d{1,3}(?:\.\d{1,3}){3})(?=\s|$)/;

export const NOTHING_NEW: ExtractionSummary = { wins: [], counts: ["Nothing new: already recorded"], ticks: [] };

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

/** Who the user is on the entry's one host, from its whoami/id output, merged by kind into what is stored. */
export interface IdentityProved {
  hostId: string;
  username: string;
  privileges: string[];
  groups: string[];
  /** Privesc vector titles the output points to. */
  vectors: string[];
}

/**
 * The identity the entry's whoami/id output proves for its host, merged by kind into the stored one (`whoami /priv`
 * changes only the privileges, and so on), with the privesc vectors it points to. Null when the entry holds no
 * identity output for one host.
 */
export async function identityOf(entry: LogEntry, hosts: Host[]): Promise<IdentityProved | null> {
  const host = hosts.find((h) => h.id === entry.hostIds[0]);
  if (!host) return null;
  const parsedBlocks = identityBlocksOf(entry).flatMap((block) => {
    const parsed = isIdentityBlockFor(entry, host, block) ? usableIdentity(block) : null;
    return parsed ? [{ parsed, command: block.command }] : [];
  });
  if (parsedBlocks.length === 0) return null;
  let merged: IdentityFields | null = (await api.hostIdentityGet(host.id)) ?? null;
  const vectors: string[] = [];
  for (const { parsed, command } of parsedBlocks) {
    merged = mergeIdentity(merged, parsed, command);
    for (const title of vectorsFromIdentity(parsed)) if (!vectors.includes(title)) vectors.push(title);
  }
  return { hostId: host.id, username: merged?.username ?? "unknown", privileges: merged?.privileges ?? [], groups: merged?.groups ?? [], vectors };
}

/** What saveCapture read before the output: the hosts as saved, the scans, and the identity. */
export interface SaveContext {
  /** The engagement's hosts as saved (including any created below). */
  hosts: Host[];
  /** Hosts this save created for a scan of an unknown IP. */
  createdHostIds: string[];
  scans: NonNullable<CaptureDraft["scan"]>[];
  identity: IdentityProved | null;
}

/** The proofs of one saved entry, and what the summary needs of how they were read. */
export interface Proved {
  proofs: ExtractionProofs;
  plan: CredentialIntakePlan | null;
  /** Where a result is, once filed: its host, or for an IP the host the store found or made for it. */
  hostOf: (p: Placement, filed: Filed) => string | null;
}

const newHostKey = (ip: string) => `new-host:${ip}`;
const ntOf = (s: string): string => ntHalf(s).toLowerCase();
const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Whether john's `--format` names this hash credential's type (by its stored type, or by the hash's shape). */
function isJohnFormat(c: Pick<Credential, "hashType" | "secret">, format: string): boolean {
  const f = format.toLowerCase();
  if (f === "nt" && /ntlm|pwdump/i.test(c.hashType ?? "")) return true;
  if (f === "mscash2" && /dcc2|mscash2/i.test(c.hashType ?? "")) return true;
  return identifyHash(c.secret).some((h) => h.johnFormat?.toLowerCase() === f);
}

/** The plan names its engagement on every record; the store takes it as an argument. */
function withoutEngagement<T extends { engagementId?: string }>(o: T): Omit<T, "engagementId"> {
  const copy: Partial<T> = { ...o };
  delete copy.engagementId;
  return copy as Omit<T, "engagementId">;
}

/** A credential as the intake adds it: a hash with no type gets the one its shape names. */
function intakeInput(planned: CredentialInput & { engagementId?: string }): CredentialInput {
  const input: CredentialInput = withoutEngagement(planned);
  if (input.type === "hash" && !input.hashType) {
    const hashType = defaultHashType(input.secret ?? "");
    if (hashType) input.hashType = hashType;
  }
  return input;
}

const attemptProof = (a: Omit<PlannedAttempt, "credId"> & { credId?: string }): PlannedAttemptProof => {
  const out = withoutEngagement(a) as PlannedAttemptProof & { logEntryId?: unknown; at?: unknown };
  delete out.logEntryId;
  delete out.at;
  return out;
};

/** A plan as the store files it: the operator accepts every pending credential except the failed-only ones. */
function intakeProof(plan: CredentialIntakePlan): IntakeProof {
  return {
    usernames: plan.newUsernames.map((u) => ({ key: plannedUsernameKey(u), input: withoutEngagement(u) })),
    attempts: plan.attempts.map(attemptProof),
    credentials: plan.newCredentials.map((p) => ({
      input: intakeInput(p.input),
      accepted: !p.failedOnly,
      attempts: p.attempts.map(attemptProof),
      fromUsername: p.fromUsername ?? null,
      ifDeclined: (p.ifDeclined ?? []).map(attemptProof),
    })),
    hashes: plan.newHashes.map(intakeInput),
    links: plan.links ?? [],
    reprovedCredentialIds: plan.reproved.credentialIds,
    reprovedUsernameIds: plan.reproved.usernameIds,
  };
}

/** Failed pairs whose secret is no stored credential are never credentials: they are tried pairs. */
function triedPairsOf(plan: CredentialIntakePlan): TriedPairInput[] {
  const tried: TriedPairInput[] = [];
  for (const p of plan.newCredentials) {
    if (!p.failedOnly || !p.input.username || !p.input.secret) continue;
    for (const a of p.attempts) {
      if (a.result !== "failed") continue;
      tried.push({
        username: p.input.username, domain: p.input.domain ?? null, secret: p.input.secret,
        secretKind: p.input.type === "hash" ? "hash" : "password", hostId: a.hostId, service: a.service, authMode: a.authMode ?? "domain",
      });
    }
  }
  return tried;
}

/** A host as the planner sees one the store will make for a new IP: named after the IP, its key for an id. */
function plannedHost(engagementId: string, ip: string): Host {
  return {
    id: newHostKey(ip), engagementId, name: ip, ip, os: null, boardColumn: "information-gathering", boardManual: false, dualHomed: false,
    boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 0, updatedAt: 0,
  };
}

/**
 * What a saved entry proves (interpreters-and-payloads spec §3.1), for the store to file in one go (`extractionFile`):
 *  1. hosts for the new IPs (only IPs the output proved), and the scans and identity saveCapture read;
 *  2. dumped credentials (`$MACHINE.ACC` named after its host), the hashes each crack cracks, and usernames;
 *  3. the nxc results as an intake plan: every working pair becomes a credential; a failed pair whose secret is no
 *     stored credential becomes a tried pair; roast hashes are added;
 *  4. privesc vectors (the identity's and the output's).
 * Reads the stored credentials and usernames to plan against. Null when nothing in the entry parsed: nothing is filed.
 */
export async function proveEntry(engagementId: string, entry: LogEntry, r: PlacedInterpretation, save: SaveContext): Promise<Proved | null> {
  const blocks = entry.content.kind === "command" ? entry.content.blocks : [];
  const hosts = [...save.hosts];
  const ipRef = new Map<string, string>();
  const proofs: ExtractionProofs = {
    createdHostIds: [...save.createdHostIds], newHosts: [], scans: [], identity: null, credentials: [], cracks: [], usernames: [],
    intake: null, triedPairs: [], vectors: [],
  };
  for (const ip of r.newIps) {
    const known = hosts.find((h) => h.ip === ip);
    if (known) ipRef.set(ip, known.id);
    else {
      proofs.newHosts.push({ key: newHostKey(ip), ip });
      hosts.push(plannedHost(engagementId, ip));
      ipRef.set(ip, newHostKey(ip));
    }
  }
  const placed = (p: Placement): string | null => ("newIp" in p ? (ipRef.get(p.newIp) ?? null) : p.hostId);
  const hostName = (id: string | null) => {
    const h = hosts.find((x) => x.id === id);
    return h?.name || h?.ip || "";
  };

  // Closed and filtered ports are not services.
  for (const s of save.scans) proofs.scans.push({ hostId: s.hostId, ports: s.ports.filter((p) => OPEN_STATES.has(p.state.toLowerCase())), os: s.os });
  if (save.identity) {
    const { hostId, username, privileges, groups } = save.identity;
    proofs.identity = { hostId, username, privileges, groups };
  }

  // Dumped and pasted credentials.
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
    proofs.credentials.push({
      type: c.type, username, domain: c.domain, secret: c.secret, hashType: c.hashType, scope: c.scope,
      localHostId: c.scope === "local" ? hostId : null, sourceHostId: hostId, source: c.source,
    });
  }

  const needsStore = blocks.length > 0 || r.cracks.length > 0;
  const [stored, storedUsers] = needsStore
    ? await Promise.all([api.credentialsList(engagementId), api.usernamesList(engagementId)]).then(([c, u]) => [c ?? [], u ?? []] as const)
    : [[], []];

  // Cracks: every hash with that value, or (john `user:password`) the only hash of that user, of the command's
  // --format when it names one. The hashes are the stored ones and those dumped above.
  const dumped = proofs.credentials.flatMap((c, i) =>
    c.type === "hash" && !stored.some((s) => s.type === "hash" && lc(s.username) === lc(c.username) && lc(s.secret) === lc(c.secret))
      ? [{ ref: i, c: { username: c.username ?? "", domain: c.domain ?? null, secret: c.secret ?? "", hashType: c.hashType ?? null } }]
      : [],
  );
  const hashes = [...stored.filter((c) => c.type === "hash").map((c) => ({ ref: c.id, c })), ...dumped];
  for (const k of r.cracks) {
    // john prints the user as in the input file, so a `DOMAIN/user` or `DOMAIN\user` prefix names the domain too.
    const prefixed = /^([^/\\]+)[/\\](.+)$/.exec((k.username ?? "").trim());
    const user = (prefixed ? prefixed[2]! : (k.username ?? "")).trim().toLowerCase();
    const userDomain = prefixed ? prefixed[1]!.trim() : null;
    let match: typeof hashes;
    if (k.hash) {
      match = hashes.filter(({ c }) => c.secret.trim().toLowerCase() === k.hash.trim().toLowerCase() || ntOf(c.secret) === ntOf(k.hash));
    } else {
      const ofUser = user ? hashes.filter(({ c }) => lc(c.username) === user && (!k.format || isJohnFormat(c, k.format))) : [];
      const inDomain = userDomain && ofUser.length ? await api.sameDomains(engagementId, ofUser.map(({ c }): DomainPair => [c.domain, userDomain])) : [];
      match = userDomain ? ofUser.filter((_, i) => inDomain[i]) : ofUser;
    }
    if (match.length === 0 || (!k.hash && match.length !== 1)) continue;
    proofs.cracks.push({
      plaintext: k.plaintext,
      credentialIds: match.flatMap(({ ref }) => (typeof ref === "string" ? [ref] : [])),
      proofCredentials: match.flatMap(({ ref }) => (typeof ref === "number" ? [ref] : [])),
    });
  }

  // Usernames. The store returns the one it lists already when this is the same username: proved again.
  for (const u of r.usernames) proofs.usernames.push({ username: u.username, domain: u.domain, sourceHostId: placed(u), source: u.source });

  // nxc results and roast hashes, planned against the hosts as they will be (new IPs included).
  const plan = blocks.length ? planCredentialIntake({ blocks, engagement: { id: engagementId }, hosts, credentials: stored, usernames: storedUsers }) : null;
  if (plan) {
    proofs.intake = intakeProof(plan);
    proofs.triedPairs = triedPairsOf(plan);
  }

  // Privesc vectors: the identity's and the output's.
  if (save.identity) for (const title of save.identity.vectors) proofs.vectors.push({ hostId: save.identity.hostId, title });
  for (const v of r.vectors) {
    const hostId = placed(v);
    if (hostId) proofs.vectors.push({ hostId, title: v.title });
  }

  const parsed = r.parsers.length > 0 || plan !== null || save.scans.length > 0 || save.identity !== null;
  const hostOf = (p: Placement, filed: Filed) => {
    const id = placed(p);
    return id === null ? null : (filed.hostIds[id] ?? id);
  };
  return parsed ? { proofs, plan, hostOf } : null;
}

const GOALS = new Map<string, ChecklistGoal>(
  [...HOST_GOALS, ...PIVOT_GOALS, ...ENGAGEMENT_SETUP, ...LATERAL_MOVEMENT_GOALS, ...AD_PLAYBOOKS.flatMap((p) => p.goals)].map((g) => [g.id, g]),
);
const HOST_GOAL_IDS = new Set([...HOST_GOALS, ...PIVOT_GOALS].map((g) => g.id));

/** The output ticks of a filed entry, its summary lines, and the DC's name. */
export interface Ticked {
  ticks: OutputTick[];
  lines: string[];
  dcNames: Set<string>;
}

/**
 * The output's checklist ticks, placed on the hosts as filed: only on goals that apply to their owner; a goal not yet
 * done gets a summary line. Reads the store as it is after filing.
 */
export async function outputTicks(engagementId: string, r: PlacedInterpretation, hostOf: (p: Placement) => string | null): Promise<Ticked> {
  const out: Ticked = { ticks: [], lines: [], dcNames: new Set() };
  const ctx = await loadTickContext(engagementId);
  const dc = findDc(ctx.hosts, ctx.servicesByHost);
  out.dcNames = new Set(dc ? [shortHostName(dc.name).toLowerCase()] : []);
  // Only for the summary wording ("Ticked …" for a goal not done yet): a failed read lists every tick.
  const state = byOwnerOf((await api.checklistList(engagementId).catch(() => [])) ?? []);
  const seen = new Set<string>();
  for (const t of r.ticks) {
    const goal = GOALS.get(t.goalId);
    if (!goal) continue;
    const hostId = hostOf(t);
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
    out.ticks.push({ ownerId, goalId: t.goalId, parser: t.parser });
    if (state.get(ownerId)?.[t.goalId]?.status !== "done") {
      out.lines.push(`Ticked '${goal.title}' on ${host ? host.name : ctx.engagement.name}`);
    }
  }
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const isMachine = (username: string) => username.trim().endsWith("$");

/** The lines shown after a save: what the store filed (`filed`), worded. */
export function summarize(x: {
  r: PlacedInterpretation;
  plan: CredentialIntakePlan | null;
  filed: Filed;
  /** The identity's host, when the entry proved one. */
  identityHostId: string | null;
  hostName: (id: string | null | undefined) => string;
  ticked: Ticked;
}): ExtractionSummary {
  const { r, plan, filed, hostName } = x;
  const record = filed.extraction.record;
  const wins: string[] = [];
  const counts: string[] = [];
  const credById = new Map(filed.credentials.map((c) => [c.id, c]));
  const created = record.createdCredentialIds.map((id) => credById.get(id)).filter((c): c is Credential => !!c);

  // Attempts this save added or whose result it changed (a re-paste only re-dates them).
  const changed = filed.attempts;
  const winCredIds = new Set<string>();
  for (const a of changed) {
    if (a.result !== "valid" && a.result !== "admin") continue;
    const c = credById.get(a.credId);
    if (!c || a.usernameId) continue;
    winCredIds.add(c.id);
    const shown = c.type === "hash" ? "NT hash" : c.secret;
    const line = isReuseAttempt(a)
      ? `${c.username}:${shown} ${reuseWording(hostName(a.hostId), c.localHostId ? hostName(c.localHostId) : null)}`
      : `${c.username}:${shown} works on ${a.service.toUpperCase()}, ${hostName(a.hostId)}${a.result === "admin" ? " (admin)" : ""}`;
    if (!wins.includes(line)) wins.push(line);
  }
  // A machine account's hash; its cleartext (an LSA secret) is counted on its own.
  const dcNames = x.ticked.dcNames;
  const machines = created.filter((c) => isMachine(c.username) && c.type === "hash");
  const machinePasswords = created.filter((c) => isMachine(c.username) && c.type !== "hash").length;
  for (const c of machines) {
    if (dcNames.has(c.username.trim().slice(0, -1).toLowerCase())) wins.push(`${c.username.trim()} hash: can DCSync`);
  }
  for (const v of filed.vectors) wins.push(`${v.title} on ${hostName(v.hostId)}`);
  for (const k of filed.cracked) wins.push(`${credById.get(k.hashId)?.username || "(no user)"}:${k.plaintext} cracked`);

  const otherMachines = machines.filter((c) => !dcNames.has(c.username.trim().slice(0, -1).toLowerCase())).length;
  const failed = changed.filter((a) => a.result === "failed").length + filed.triedPairsAdded;
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
    if (scan.services) counts.push(`${plural(scan.services, "service", "services")} updated on ${hostName(scan.hostId)}`);
    if (scan.osSet) counts.push(`OS set on ${hostName(scan.hostId)}`);
  }
  if (filed.identityChanged) counts.push(`Identity updated on ${hostName(x.identityHostId)}`);
  // News even when nothing was filed: results Raven kept out, and a host that moved.
  if (r.droppedUnknown) counts.push(`${plural(r.droppedUnknown, "result", "results")} on hosts not in this engagement`);
  if (r.outOfScope) counts.push(`${plural(r.outOfScope, "result", "results")} outside this engagement's scope`);
  for (const c of plan?.ipChanges ?? []) counts.push(`${c.hostName} answered on ${c.to}`);

  const somethingNew =
    wins.length > 0 || counts.length > 0 || x.ticked.lines.length > 0 || record.credentialsBefore.length > 0 || changed.length > 0;
  if (!somethingNew) return NOTHING_NEW;
  return { wins, counts, ticks: x.ticked.lines };
}
