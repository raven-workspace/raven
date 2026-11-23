import type { Finding } from "../../types/findings";
import type { LogEntry } from "../../types/log";
import { byTime, draftable, hostName, isDeadEnd, isFlag, keptFromReport, provingEntries, type ProofReason } from "./prove";
import { isPortScan } from "./tools";
import type { Phase, ReportData, ReportTarget } from "./types";

/**
 * The placement plan (GLOSSARY.md): where each log entry of a report target would go on a freshly drafted page, decided
 * from the logged record alone. It never reads the owner's page (docs/adr/0001): whether an entry is on the page is
 * always asked of the page. The page printing (`plain.ts`), the evidence column, Add new evidence (`place.ts`) and the
 * checks read it; none decides placement on its own.
 */

/* ------------------------------------------------------------------ Phases */

/** The phases a machine's numbered steps are told in, in page order. */
export const STEP_PHASES: readonly Phase[] = ["foothold", "lateral", "privesc", "domain"];
/** The phases with a heading of their own, in page order: Service enumeration, the step phases, Post-exploitation. */
export const PAGE_PHASES: readonly Phase[] = ["enum", ...STEP_PHASES, "post"];
/** Each page phase's heading, in the sample's wording. */
export const PHASE_TITLE: Readonly<Partial<Record<Phase, string>>> = {
  enum: "Service enumeration",
  foothold: "Initial access",
  lateral: "Lateral movement",
  privesc: "Privilege escalation",
  domain: "Domain compromise",
  post: "Post-exploitation",
};

/* ------------------------------------------------------------------ Windows */

/** A screenshot taken this long after a step's lead (or between two steps) illustrates that step. */
export const ILLUSTRATE_WINDOW_MS = 5 * 60_000;
/** A screenshot taken this long either side of a flag (and nearest to it) goes with that flag. */
export const FLAG_WINDOW_MS = 15 * 60_000;

/* ------------------------------------------------------------------ The plan */

/** What a log entry is in the plan. Every entry of the target has exactly one. */
export type Role =
  /** It leads a step: an access, a hop, a flag or a finding step. */
  | "leads"
  /** A screenshot taken just after a step's lead, or between two steps: it illustrates the step before it. */
  | "illustrates"
  /** A flag's companion: a command that prints the flag, or a screenshot of it (`proofCompanions`). */
  | "with-flag"
  /** A flag whose value the step before it already prints: it joins that step. */
  | "absorbed"
  /** The machine's first port scan, printed under Service enumeration (standalone targets). */
  | "scan"
  | "not-placed";

/** Why an entry is not placed. */
export type NotPlacedReason =
  /** Kept from the report (GLOSSARY.md). */
  | "kept"
  /** Tied to a failed attempt, or marked as returning nothing. */
  | "dead-end"
  /** A note: its words are the owner's to place. */
  | "note"
  /** It proves something (goal evidence, a service, a port scan) that the page shows without the entry. */
  | "proves-without-placing"
  /** A screenshot near no step. */
  | "not-near-a-step"
  /** Anything else: it proves nothing. */
  | "proves-nothing";

/** One numbered step: its lead, and every entry it holds in print order (the lead among them). */
export interface PlanStep {
  lead: LogEntry;
  entries: LogEntry[];
}

/** A finding section ("Initial access: <title>"), or a phase with no finding (`finding` null). Post-exploitation is a
 *  section of phase `post`. */
export interface PlanSection {
  phase: Phase;
  finding: Finding | null;
  steps: PlanStep[];
}

/** One machine of the target, in page order. */
export interface PlanMachine {
  hostId: string;
  /** The first port scan Service enumeration prints (standalone targets only). */
  scan: LogEntry | null;
  sections: PlanSection[];
  /** The findings placed under this machine that enabled no phase: Additional findings, in page order. */
  additional: Finding[];
}

/** Where one entry goes. `phase` is the phase a new step for it opens (`phaseInsertAt`): a stepped entry's own, and for
 *  a flag's companion or an entry not placed, the phase it was logged in. A flag closing the last phase's steps keeps
 *  its own phase (`post` for a proof flag). */
export interface Placement {
  entry: LogEntry;
  role: Role;
  reason: NotPlacedReason | null;
  hostId: string;
  phase: Phase;
  section: PlanSection | null;
  step: PlanStep | null;
}

export interface PlacementPlan {
  target: ReportTarget;
  machines: PlanMachine[];
  /** Each of the target's findings: the machine it is placed under and the phase it enabled (`additional`: none). */
  findings: Map<string, { hostId: string; phase: Phase }>;
  /** Where an entry of the target goes; undefined for an entry on none of its machines. */
  at(entryId: string): Placement | undefined;
  /** The machine and phase any entry belongs under: its placement's, and for an entry on none of the target's machines,
   *  the phase it would open on the first one. */
  phaseOf(entry: LogEntry): { hostId: string; phase: Phase };
  /** The ids of every entry the plan places (any role but `not-placed`). */
  placed: ReadonlySet<string>;
}

const plans = new WeakMap<ReportData, Map<string, PlacementPlan>>();

/** The target's placement plan, built once per data and target. */
export function placementPlan(data: ReportData, target: ReportTarget): PlacementPlan {
  const key = `${target.kind}:${target.hostIds.join(",")}`;
  const byTarget = plans.get(data) ?? new Map<string, PlacementPlan>();
  plans.set(data, byTarget);
  let plan = byTarget.get(key);
  if (!plan) {
    plan = buildPlan(data, target);
    byTarget.set(key, plan);
  }
  return plan;
}

/* ------------------------------------------------------------------ Which entries place */

/** The reasons that place an entry on the page (§10.2): goal evidence and service confirmation alone stay in the rail. */
const PLACING: ReadonlySet<ProofReason> = new Set<ProofReason>(["access", "hop", "flag", "finding-step"]);

/** The host's entries that lead a step: proving entries (`provingEntries`) with an access, hop, flag or finding-step
 *  reason. */
export function placingEntries(data: ReportData, hostId: string): Set<string> {
  const out = new Set<string>();
  for (const [id, reasons] of provingEntries(data, hostId)) if (reasons.some((r) => PLACING.has(r))) out.add(id);
  return out;
}

/** The host's first port scan neither kept from the report nor a dead end: the one Service enumeration prints. */
export const firstScan = (data: ReportData, hostId: string): LogEntry | undefined =>
  data.log.filter((e) => e.hostIds.includes(hostId) && isPortScan(e) && draftable(data, e)).sort((a, b) => a.at - b.at || a.createdAt - b.createdAt)[0];

/** The host's entries that land in a step, in time order: placing ones (notes and port scans aside: the ports table
 *  covers a scan, §10.2), and screenshots taken between two of them or within `ILLUSTRATE_WINDOW_MS` after one. */
function steppedEntries(data: ReportData, hostId: string, placing: ReadonlySet<string>): LogEntry[] {
  const proven = data.log.filter((e) => placing.has(e.id) && e.kind !== "note" && !isPortScan(e));
  const shots = data.log.filter(
    (e) =>
      e.kind === "screenshot" &&
      !placing.has(e.id) &&
      e.hostIds.includes(hostId) &&
      draftable(data, e) &&
      (proven.some((k) => e.at >= k.at && e.at - k.at <= ILLUSTRATE_WINDOW_MS) ||
        (proven.some((k) => k.at <= e.at) && proven.some((k) => k.at >= e.at))),
  );
  return [...proven, ...shots].sort(byTime);
}

/* ------------------------------------------------------------------ Flag companions */

const NAMES_FLAG = /\bflags?\b/i;
const namesKind = (text: string, kind: "local" | "proof") => new RegExp(`\\b${kind}(?:\\.txt)?\\b`, "i").test(text);
const flagOf = (e: LogEntry) => (e.content.kind === "flag" ? e.content : null);
const shotText = (e: LogEntry) => `${e.content.kind === "screenshot" ? e.content.caption : ""}\n${e.title}`;

/**
 * The entries that show a flag's proof alongside the flag entry itself, as real captures make them: the flag is often
 * logged as just its value, the proof as a separate command (`cat proof.txt; whoami; ip a`) or screenshot. On the same
 * host, neither kept from the report nor a dead end (`draftable`):
 *  - commands whose output (or command) holds the flag's value;
 *  - screenshots that name this flag (`proof`, `proof.txt`; or `flag` when this flag is the nearest one), or that were
 *    taken within `FLAG_WINDOW_MS` of it, name no other flag, and are nearer to it than to any other step of the host.
 *    A screenshot that proves something itself (a finding's step, an access grant) is that step's, never a companion.
 * In time order, commands before screenshots. The checks read a flag's proof from these too.
 */
export function proofCompanions(data: ReportData, hostId: string, flagEntry: LogEntry): LogEntry[] {
  const flag = flagOf(flagEntry);
  if (!flag) return [];
  const value = flag.value.trim().toLowerCase();
  const onHost = data.log.filter((e) => e.id !== flagEntry.id && !e.private && e.hostIds.includes(hostId));
  const candidates = onHost.filter((e) => draftable(data, e));
  const commands =
    value.length >= 8
      ? candidates.filter(
          (e) =>
            e.content.kind === "command" &&
            e.content.blocks.some((b) => `${b.command ?? ""}\n${b.output ?? ""}`.toLowerCase().includes(value)),
        )
      : [];
  const proving = provingEntries(data, hostId);
  const flags = onHost.filter((e) => flagOf(e) !== null);
  // The host's steps a screenshot could belong to: its proving entries (notes aside) and its flags.
  const steps = onHost.filter((e) => e.kind !== "screenshot" && e.kind !== "note" && (proving.has(e.id) || flagOf(e) !== null));
  const nearest = (shot: LogEntry, among: LogEntry[]) => {
    const gap = (e: LogEntry) => Math.abs(e.at - shot.at);
    const mine = gap(flagEntry);
    return among.every((e) => gap(e) > mine);
  };
  const other = flag.flagKind === "local" ? "proof" : "local";
  const shots = candidates.filter((e) => {
    if (e.content.kind !== "screenshot" || proving.has(e.id)) return false;
    const text = shotText(e);
    if (namesKind(text, flag.flagKind)) return nearest(e, flags.filter((f) => flagOf(f)?.flagKind === flag.flagKind));
    if (namesKind(text, other)) return false;
    if (NAMES_FLAG.test(text)) return nearest(e, flags);
    return Math.abs(e.at - flagEntry.at) <= FLAG_WINDOW_MS && nearest(e, steps);
  });
  return [...commands.sort(byTime), ...shots.sort(byTime)];
}

/**
 * Each of a host's stepped flags with the companions that go with it: a placed entry (a finding's step, an access
 * step, a hop) stays where it leads, and a goal's evidence that prints the flag joins it. An entry goes with the first
 * flag that claims it. "Goes with a flag" beats "illustrates a step": a screenshot both would take goes with the flag.
 */
function flagCompanions(data: ReportData, hostId: string, stepped: LogEntry[], placing: ReadonlySet<string>): Map<string, LogEntry[]> {
  const out = new Map<string, LogEntry[]>();
  const taken = new Set<string>();
  for (const f of stepped.filter(isFlag)) {
    const mine = proofCompanions(data, hostId, f).filter((c) => !placing.has(c.id) && !isFlag(c) && !taken.has(c.id));
    for (const c of mine) taken.add(c.id);
    out.set(f.id, mine);
  }
  return out;
}

/* ------------------------------------------------------------------ Machines and phases */

export type HostEntry = "foothold" | "hop";

/** The AD set's domain controller: the host running Kerberos (88) and LDAP (389), else the last one a hop reached. */
export function domainController(data: ReportData, hostIds: string[]): string | null {
  const ids = new Set(hostIds);
  for (const id of hostIds) {
    const ports = new Set(data.services.filter((s) => s.hostId === id).map((s) => s.port));
    if (ports.has(88) && ports.has(389)) return id;
  }
  const hops = data.hops.filter((h) => ids.has(h.toHostId)).sort((a, b) => a.at - b.at);
  return hops.length > 0 ? hops[hops.length - 1].toHostId : null;
}

const adHostIds = (data: ReportData) => data.hosts.filter((h) => h.adSetEffective).map((h) => h.id);

/** A machine was entered by a hop when some hop from another machine reached it. */
export function hostEntry(data: ReportData, target: ReportTarget, hostId: string): HostEntry {
  if (target.kind === "standalone") return "foothold";
  return data.hops.some((h) => h.toHostId === hostId && h.fromHostId != null) ? "hop" : "foothold";
}

/** The two phases a host's steps split into. The DC is all domain compromise. */
function phaseNames(data: ReportData, hostId: string, entry: HostEntry): [Phase, Phase] {
  const isAd = data.hosts.some((h) => h.id === hostId && h.adSetEffective);
  if (isAd && domainController(data, adHostIds(data)) === hostId) return ["domain", "domain"];
  return [entry === "hop" ? "lateral" : "foothold", "privesc"];
}

/**
 * §5.1: before the first access on the host (a grant, the first local flag, or the hop that entered it), port scans are
 * Service Enumeration when `enumerate` (standalone targets); the rest up to and including that access is the entry
 * phase, local flags included wherever they were logged; then privilege escalation (domain compromise on the DC) up to
 * and including the first admin or SYSTEM access; the proof flag and every step after that access are
 * post-exploitation. With no boundary, every step is the entry phase. A screenshot that leads no step takes the phase
 * of the entry logged before it.
 */
function phaseSplit(entries: LogEntry[], data: ReportData, hostId: string, entry: HostEntry, enumerate: boolean, placing: ReadonlySet<string>): Map<string, Phase> {
  const sorted = [...entries].sort(byTime);
  const [first, second] = phaseNames(data, hostId, entry);

  /** The entry's position when it is on the list, else the last one logged at or before `at`; -1 when it was
   *  before everything (access given up front, such as starting credentials, is no boundary). */
  const indexOf = (logEntryId: string | null, at: number) => {
    const i = sorted.findIndex((e) => e.id === logEntryId);
    if (i !== -1) return i;
    let last = -1;
    sorted.forEach((e, j) => {
      if (e.at <= at) last = j;
    });
    return last;
  };
  const earliest = (list: number[]) => {
    const found = list.filter((i) => i !== -1);
    return found.length > 0 ? Math.min(...found) : Infinity;
  };

  const grants = data.grants.filter((g) => g.hostId === hostId);
  const candidates = grants.map((g) => indexOf(g.logEntryId, g.at));
  if (entry === "hop") {
    for (const h of data.hops) if (h.toHostId === hostId) candidates.push(indexOf(h.logEntryId, h.at));
  }
  sorted.forEach((e, i) => {
    if (e.content.kind === "flag" && e.content.flagKind === "local") candidates.push(i);
  });
  const boundary = earliest(candidates);
  const root = earliest(grants.filter((g) => g.level === "admin" || g.level === "system").map((g) => indexOf(g.logEntryId, g.at)));

  const out = new Map<string, Phase>();
  let anchor: Phase | null = null;
  sorted.forEach((e, i) => {
    if (e.kind === "screenshot" && !placing.has(e.id)) {
      out.set(e.id, anchor ?? first);
      return;
    }
    let phase: Phase;
    if (e.content.kind === "flag") phase = e.content.flagKind === "local" ? first : "post";
    else if (i > root) phase = "post";
    else if (i < boundary && enumerate && isPortScan(e)) phase = "enum";
    else phase = i <= boundary ? first : second;
    out.set(e.id, phase);
    anchor = phase;
  });
  return out;
}

/** Entries in time order as steps: each leading entry with the screenshots that illustrate it (those after it). */
function stepsOf(entries: LogEntry[], placing: ReadonlySet<string>): LogEntry[][] {
  const steps: LogEntry[][] = [];
  for (const e of entries) {
    const illustrates = e.kind === "screenshot" && !placing.has(e.id) && steps.length > 0;
    if (illustrates) steps[steps.length - 1].push(e);
    else steps.push([e]);
  }
  return steps;
}

/* ------------------------------------------------------------------ Findings */

/** The order findings are told in: most severe first, unrated after rated ones, info last; then by title. */
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const severityRank = (f: Finding) => (f.severity == null ? 4 : f.severity === "info" ? 5 : SEVERITY_RANK[f.severity]);
/** Observations: they never enable a phase, whatever steps they link. */
const isObservation = (f: Finding) => f.severity === "info" || f.severity === "low";

/** Words that make a finding a privilege escalation: a token privilege, sudo, SUID, a service or task, a kernel bug. */
const PRIVESC_WORDS =
  /\b(?:privilege escalation|privesc|SeImpersonate\w*|SeBackup\w*|SeDebug\w*|SeAssignPrimaryToken\w*|potato\w*|PrintSpoofer|sudo(?:ers)?|SUID|setuid|capabilit(?:y|ies)|cron(?:tab)?|AlwaysInstallElevated|unquoted service|service (?:binary|permissions?)|scheduled task|kernel exploit|DLL hijack\w*|token impersonation|to (?:root|SYSTEM)|gives? (?:root|SYSTEM))\b/i;
const readsPrivesc = (f: Finding) => PRIVESC_WORDS.test([f.title, f.description ?? "", ...(f.refs ?? [])].join("\n"));

/**
 * Which phase each of a host's findings enabled: the phase of its first step (a step phase only). Findings with no
 * such step, and observations (info, low), enabled none: they are Additional findings. One exception keeps findings
 * that were never linked to their steps (imported ones) in the story: an entry phase or privilege escalation with no
 * finding takes the most severe unlinked medium-or-worse finding whose words fit it (privilege escalation words:
 * SeImpersonate, sudo, SUID…; the entry phase takes only findings without them), then the oldest. Words come before
 * severity: a privilege escalation finding never opens the entry phase.
 */
function findingPhases(findings: Finding[], split: Map<string, Phase>, time: Map<string, number>, [entryPhase, second]: [Phase, Phase]): Map<string, Phase | null> {
  const out = new Map<string, Phase | null>();
  for (const f of findings) {
    const steps = f.stepEntryIds.filter((id) => STEP_PHASES.includes(split.get(id) as Phase));
    steps.sort((a, b) => (time.get(a) ?? 0) - (time.get(b) ?? 0));
    out.set(f.id, !isObservation(f) && steps.length > 0 ? split.get(steps[0])! : null);
  }
  const unlinked = findings.filter((f) => !isObservation(f) && f.severity != null && f.stepEntryIds.length === 0);
  const twoPhases = second !== entryPhase;
  const fill = (phase: Phase, privesc: boolean) => {
    if ([...out.values()].includes(phase)) return;
    const pick = unlinked
      .filter((f) => out.get(f.id) == null && (!twoPhases || readsPrivesc(f) === privesc))
      .sort((a, b) => severityRank(a) - severityRank(b) || a.createdAt - b.createdAt)[0];
    if (pick) out.set(pick.id, phase);
  };
  if (twoPhases) fill(second, true);
  fill(entryPhase, false);
  return out;
}

/**
 * An AD set's machines in attack-path order: by when each was first reached (its first hop in or access grant, as the
 * attack chain orders them), so the entry machine comes first; the domain controller last; name breaks ties and
 * places machines never reached after the rest.
 */
export function machineOrder(data: ReportData, hostIds: string[]): string[] {
  const dc = domainController(data, hostIds);
  const reached = (id: string) =>
    Math.min(
      ...data.hops.filter((h) => h.toHostId === id).map((h) => h.at),
      ...data.grants.filter((g) => g.hostId === id).map((g) => g.at),
      Infinity,
    );
  return [...hostIds].sort((a, b) => Number(a === dc) - Number(b === dc) || reached(a) - reached(b) || hostName(data, a).localeCompare(hostName(data, b)));
}

export const machinesInOrder = (data: ReportData, target: ReportTarget) => (target.kind === "standalone" ? [...target.hostIds] : machineOrder(data, target.hostIds));

/** Which machine of an AD set each of its findings is placed under: the machine of its first step logged on one of
 *  them, else the first of its machines in page order. */
function findingOwners(data: ReportData, machines: string[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const f of data.findings) {
    const mine = machines.filter((id) => f.hostIds.includes(id));
    if (mine.length === 0) continue;
    const steps = f.stepEntryIds.flatMap((id) => data.log.find((e) => e.id === id) ?? []).sort(byTime);
    const first = steps.flatMap((e) => mine.filter((id) => e.hostIds.includes(id)))[0];
    owners.set(f.id, first ?? mine[0]);
  }
  return owners;
}

/* ------------------------------------------------------------------ Building the plan */

/** Whether an entry's own evidence prints `value`: a command's output, an HTTP response, a flag's proof or value. */
function prints(e: LogEntry, value: string): boolean {
  const c = e.content;
  if (c.kind === "command") return c.blocks.some((b) => (b.output ?? "").includes(value));
  if (c.kind === "http") return (c.response ?? "").includes(value);
  if (c.kind === "flag") return (c.proof?.trim() ? c.proof : c.value).includes(value);
  return false;
}

/** Why an entry the plan doesn't place stays off the page. */
function notPlacedReason(data: ReportData, hostId: string, e: LogEntry): NotPlacedReason {
  if (keptFromReport(data, e)) return "kept";
  if (isDeadEnd(e, data)) return "dead-end";
  if (e.kind === "note") return "note";
  if (provingEntries(data, hostId).has(e.id)) return "proves-without-placing";
  return e.kind === "screenshot" ? "not-near-a-step" : "proves-nothing";
}

interface MachineBuild {
  machine: PlanMachine;
  /** Where each entry of the machine goes. */
  placements: Map<string, Placement>;
  /** The phase an entry outside the machine's steps would open a step in. */
  wouldBe(entry: LogEntry): Phase;
}

/** One machine's part of the plan. `owns` says which findings it is placed under. */
function buildMachine(data: ReportData, target: ReportTarget, hostId: string, owns: (f: Finding) => boolean): MachineBuild & { phases: Map<string, Phase | null> } {
  const how = hostEntry(data, target, hostId);
  const enumerate = target.kind === "standalone";
  const placing = placingEntries(data, hostId);
  const stepped = steppedEntries(data, hostId, placing);
  const companions = flagCompanions(data, hostId, stepped, placing);
  const moved = new Set([...companions.values()].flat().map((e) => e.id));
  const kept = stepped.filter((e) => !moved.has(e.id));
  const split = phaseSplit(kept, data, hostId, how, enumerate, placing);
  const time = new Map(kept.map((e) => [e.id, e.at]));
  const findings = data.findings.filter((f) => f.hostIds.includes(hostId) && owns(f));
  const phases = findingPhases(findings, split, time, phaseNames(data, hostId, how));
  const firstStep = (f: Finding) => Math.min(...f.stepEntryIds.map((id) => time.get(id) ?? Infinity), Infinity);
  const stepsIn = (phase: Phase) => stepsOf(kept.filter((e) => split.get(e.id) === phase), placing);

  // The phase an entry outside the steps would open a step in: as if it were logged among them.
  const around = [...kept, ...[...companions.values()].flat().filter((e) => e.kind === "screenshot")];
  const wouldBe = (e: LogEntry) =>
    phaseSplit([...around.filter((k) => k.id !== e.id), e], data, hostId, how, enumerate, placing).get(e.id) ?? phaseNames(data, hostId, how)[0];

  const placements = new Map<string, Placement>();
  const place = (e: LogEntry, role: Role, phase: Phase, section: PlanSection | null, step: PlanStep | null) =>
    placements.set(e.id, { entry: e, role, reason: null, hostId, phase, section, step });

  /** A flag (with the screenshots that illustrate it) closing a section's steps: it joins the step before it when that
   *  step already prints its value and no command of its own comes with it; else it leads a step of its own. */
  const closeWith = (section: PlanSection, [flag, ...along]: LogEntry[]) => {
    const mine = companions.get(flag.id) ?? [];
    const commands = mine.filter((e) => e.kind !== "screenshot");
    const shots = mine.filter((e) => e.kind === "screenshot");
    const phase = split.get(flag.id)!;
    const last = section.steps[section.steps.length - 1];
    const value = flagOf(flag)?.value.trim() ?? "";
    let step: PlanStep;
    if (commands.length === 0 && last && value.length >= 8 && last.entries.some((e) => prints(e, value))) {
      step = last;
      step.entries.push(flag, ...along, ...shots);
      place(flag, "absorbed", phase, section, step);
    } else {
      step = { lead: flag, entries: [...commands, flag, ...along, ...shots] };
      section.steps.push(step);
      place(flag, "leads", phase, section, step);
    }
    for (const e of along) place(e, "illustrates", split.get(e.id)!, section, step);
    for (const e of mine) place(e, "with-flag", wouldBe(e), section, step);
  };
  const walkStep = (section: PlanSection, entries: LogEntry[]): PlanStep => {
    const step: PlanStep = { lead: entries[0], entries: [...entries] };
    entries.forEach((e, i) => place(e, i === 0 ? "leads" : "illustrates", split.get(e.id)!, section, step));
    return step;
  };

  const sections: PlanSection[] = [];
  for (const phase of STEP_PHASES) {
    const steps = stepsIn(phase);
    const here = findings.filter((f) => phases.get(f.id) === phase).sort((a, b) => firstStep(a) - firstStep(b) || severityRank(a) - severityRank(b));
    if (steps.length === 0 && here.length === 0) continue;
    const walk = steps.filter((st) => !isFlag(st[0]));
    const flags = steps.filter((st) => isFlag(st[0]));
    // Each step names its finding section: the finding whose step it is; a step of none, the section of the step
    // before it (the phase's first section for the first step).
    const groupOf: number[] = [];
    walk.forEach((st, i) => {
      const owner = here.findIndex((f) => st.some((e) => f.stepEntryIds.includes(e.id)));
      groupOf.push(owner !== -1 ? owner : i > 0 ? groupOf[i - 1] : 0);
    });
    const groups: (Finding | null)[] = here.length > 0 ? here : [null];
    groups.forEach((finding, k) => {
      const section: PlanSection = { phase, finding, steps: [] };
      walk.forEach((st, i) => {
        if (groupOf[i] === k) section.steps.push(walkStep(section, st));
      });
      // The local flag closes the phase: the last step of its last section.
      if (k === groups.length - 1) for (const fl of flags) closeWith(section, fl);
      sections.push(section);
    });
  }
  // Post-exploitation: the proof flag closes the last phase's steps (as the sample reads it); anything else done after
  // root is a section of its own.
  const post = stepsIn("post");
  const postFlags = post.filter((st) => isFlag(st[0]));
  const postWalk = post.filter((st) => !isFlag(st[0]));
  const closing = sections[sections.length - 1];
  if (closing) for (const fl of postFlags) closeWith(closing, fl);
  if (postWalk.length > 0 || (!closing && postFlags.length > 0)) {
    const section: PlanSection = { phase: "post", finding: null, steps: [] };
    for (const st of postWalk) section.steps.push(walkStep(section, st));
    if (!closing) for (const fl of postFlags) closeWith(section, fl);
    sections.push(section);
  }

  const scan = enumerate ? (firstScan(data, hostId) ?? null) : null;
  if (scan) place(scan, "scan", "enum", null, null);

  // Every other entry of the machine: not placed, with the phase a step for it would open.
  for (const e of data.log) {
    if (!e.hostIds.includes(hostId) || placements.has(e.id)) continue;
    placements.set(e.id, { entry: e, role: "not-placed", reason: notPlacedReason(data, hostId, e), hostId, phase: wouldBe(e), section: null, step: null });
  }

  const additional = findings
    .filter((f) => phases.get(f.id) == null)
    .sort((a, b) => severityRank(a) - severityRank(b) || a.title.localeCompare(b.title));
  return { machine: { hostId, scan, sections, additional }, placements, phases, wouldBe };
}

function buildPlan(data: ReportData, target: ReportTarget): PlacementPlan {
  const machineIds = machinesInOrder(data, target);
  const owner = target.kind === "standalone" ? null : findingOwners(data, machineIds);
  const findings = new Map<string, { hostId: string; phase: Phase }>();
  const builds = new Map<string, MachineBuild>();
  for (const hostId of machineIds) {
    const owns = owner ? (f: Finding) => owner.get(f.id) === hostId : () => true;
    const built = buildMachine(data, target, hostId, owns);
    for (const [fid, phase] of built.phases) if (!findings.has(fid)) findings.set(fid, { hostId, phase: phase ?? "additional" });
    builds.set(hostId, built);
  }
  const placed = new Set<string>();
  for (const b of builds.values()) for (const [id, p] of b.placements) if (p.role !== "not-placed") placed.add(id);
  const lookup = new Map<string, Placement>();
  for (const e of data.log) {
    const hosts = e.hostIds.filter((h) => builds.has(h));
    if (hosts.length === 0) continue;
    // An entry on several machines answers for the first one that places it, else its first machine in the target.
    const all = hosts.map((h) => builds.get(h)!.placements.get(e.id)!);
    lookup.set(e.id, all.find((p) => p.role !== "not-placed") ?? all[0]);
  }
  return {
    target,
    machines: machineIds.map((h) => builds.get(h)!.machine),
    findings,
    at: (id) => lookup.get(id),
    phaseOf(entry) {
      const p = lookup.get(entry.id);
      if (p) return { hostId: p.hostId, phase: p.phase };
      const hostId = target.hostIds[0];
      return { hostId, phase: builds.get(hostId)?.wouldBe(entry) ?? "foothold" };
    },
    placed,
  };
}
