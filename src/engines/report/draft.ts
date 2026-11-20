import type { Finding } from "../../types/findings";
import type { LogEntry } from "../../types/log";
import { proofCompanions } from "./proof";
import { byTime, hostName, isDeadEnd, isFlag, placingEntries } from "./prove";
import { isPortScan } from "./tools";
import type { Phase, ReportData, ReportTarget } from "./types";

/** How a screenshot taken after a kept entry still comes along with it. */
const SCREENSHOT_WINDOW_MS = 5 * 60_000;
export type HostEntry = "foothold" | "hop";

/** The host's entries that land on the page, in time order: placing ones (notes and port scans aside: the ports table
 *  covers a scan, §10.2; `placingEntries`), and
 *  screenshots taken between two of them or within a few minutes after one (each joins the step before it). */
function keptEntries(data: ReportData, hostId: string): LogEntry[] {
  const placing = placingEntries(data, hostId);
  const proven = data.log.filter((e) => placing.has(e.id) && e.kind !== "note" && !isPortScan(e));
  const shots = data.log.filter(
    (e) =>
      e.kind === "screenshot" &&
      !placing.has(e.id) &&
      !e.private &&
      e.hostIds.includes(hostId) &&
      !isDeadEnd(e, data) &&
      (proven.some((k) => e.at >= k.at && e.at - k.at <= SCREENSHOT_WINDOW_MS) ||
        (proven.some((k) => k.at <= e.at) && proven.some((k) => k.at >= e.at))),
  );
  return [...proven, ...shots].sort(byTime);
}

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
 * post-exploitation. With no boundary, every step is the entry phase. A screenshot that only came along with a placed
 * entry takes that entry's phase (the placed entry logged before it).
 */
export function phaseSplit(entries: LogEntry[], data: ReportData, hostId: string, entry: HostEntry, enumerate = false): Map<string, Phase> {
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

  const placing = placingEntries(data, hostId);
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

/** Entries in time order as steps: each placed entry with the screenshots that came along after it. */
export function stepsOf(entries: LogEntry[], placing: ReadonlySet<string>): LogEntry[][] {
  const steps: LogEntry[][] = [];
  for (const e of entries) {
    const tagsAlong = e.kind === "screenshot" && !placing.has(e.id) && steps.length > 0;
    if (tagsAlong) steps[steps.length - 1].push(e);
    else steps.push([e]);
  }
  return steps;
}

/** The order findings are told in: most severe first, unrated after rated ones, info last; then by title. */
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const severityRank = (f: Finding) => (f.severity == null ? 4 : f.severity === "info" ? 5 : SEVERITY_RANK[f.severity]);
/** Observations: they never enable a phase, whatever steps they link. */
const isObservation = (f: Finding) => f.severity === "info" || f.severity === "low";

/**
 * A flag's companions (`proofCompanions`) the page shows in the flag's step. A placed entry (a finding's step, an
 * access step, a hop) stays in its phase: its text still counts for the proof, but it is never moved. A goal's
 * evidence is not placed, so one that prints the flag joins the flag's step.
 */
export function blockCompanions(data: ReportData, hostId: string, flag: LogEntry): LogEntry[] {
  const placing = placingEntries(data, hostId);
  return proofCompanions(data, hostId, flag).filter((c) => !placing.has(c.id) && !isFlag(c));
}

/**
 * Each of a host's kept flags with the companions its block shows (`blockCompanions`). An entry goes with the first
 * flag that claims it.
 */
function flagCompanions(data: ReportData, hostId: string, kept: LogEntry[]): Map<string, LogEntry[]> {
  const out = new Map<string, LogEntry[]>();
  const taken = new Set<string>();
  for (const f of kept.filter(isFlag)) {
    const mine = blockCompanions(data, hostId, f).filter((c) => !taken.has(c.id));
    for (const c of mine) taken.add(c.id);
    out.set(f.id, mine);
  }
  return out;
}

/** Words that make a finding a privilege escalation: a token privilege, sudo, SUID, a service or task, a kernel bug. */
const PRIVESC_WORDS =
  /\b(?:privilege escalation|privesc|SeImpersonate\w*|SeBackup\w*|SeDebug\w*|SeAssignPrimaryToken\w*|potato\w*|PrintSpoofer|sudo(?:ers)?|SUID|setuid|capabilit(?:y|ies)|cron(?:tab)?|AlwaysInstallElevated|unquoted service|service (?:binary|permissions?)|scheduled task|kernel exploit|DLL hijack\w*|token impersonation|to (?:root|SYSTEM)|gives? (?:root|SYSTEM))\b/i;
const readsPrivesc = (f: Finding) => PRIVESC_WORDS.test([f.title, f.description ?? "", ...(f.refs ?? [])].join("\n"));

/**
 * Which phase each of a host's findings enabled: the phase of its first step (an entry phase only). Findings with no
 * such step, and observations (info, low), enabled none: they are Additional findings. One exception keeps findings
 * that were never linked to their steps (imported ones) in the story: an entry phase or privilege escalation with no
 * finding takes the most severe unlinked medium-or-worse finding whose words fit it (privilege escalation words:
 * SeImpersonate, sudo, SUID…; the entry phase takes only findings without them), then the oldest. Words come before
 * severity: a privilege escalation finding never opens the entry phase.
 */
function findingPhases(
  findings: Finding[],
  split: Map<string, Phase>,
  time: Map<string, number>,
  [entryPhase, second]: [Phase, Phase],
): Map<string, Phase | null> {
  const out = new Map<string, Phase | null>();
  for (const f of findings) {
    const steps = f.stepEntryIds.filter((id) => STEP_PHASES.has(split.get(id) as Phase));
    steps.sort((a, b) => (time.get(a) ?? 0) - (time.get(b) ?? 0));
    out.set(f.id, !isObservation(f) && steps.length > 0 ? split.get(steps[0])! : null);
  }
  const unlinked = findings.filter((f) => !isObservation(f) && f.severity != null && f.stepEntryIds.length === 0);
  const twoPhases = second !== entryPhase;
  // Phase words before severity: a finding that reads as privilege escalation only ever opens Privilege Escalation
  // (when the host has one), whatever its severity, even when that phase already has its own finding.
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

const STEP_PHASES = new Set<Phase>(["foothold", "lateral", "privesc", "domain"]);

/** What the draft decides for one machine: its kept entries (flag companions taken out), each one's phase, its
 *  findings and the phase each enabled (null: Additional findings). */
export interface HostPlan {
  kept: LogEntry[];
  companions: Map<string, LogEntry[]>;
  split: Map<string, Phase>;
  placing: Set<string>;
  findings: Finding[];
  phases: Map<string, Phase | null>;
  time: Map<string, number>;
}

export function hostPlan(data: ReportData, hostId: string, entry: HostEntry, enumerate: boolean, owns: (findingId: string) => boolean): HostPlan {
  const all = keptEntries(data, hostId);
  const companions = flagCompanions(data, hostId, all);
  const moved = new Set([...companions.values()].flat().map((e) => e.id));
  const kept = all.filter((e) => !moved.has(e.id));
  const split = phaseSplit(kept, data, hostId, entry, enumerate);
  const time = new Map(kept.map((e) => [e.id, e.at]));
  const findings = data.findings.filter((f) => f.hostIds.includes(hostId) && owns(f.id));
  const phases = findingPhases(findings, split, time, phaseNames(data, hostId, entry));
  return { kept, companions, split, placing: placingEntries(data, hostId), findings, phases, time };
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
  return [...hostIds].sort(
    (a, b) =>
      Number(a === dc) - Number(b === dc) || reached(a) - reached(b) || hostName(data, a).localeCompare(hostName(data, b)),
  );
}

export const machinesInOrder = (data: ReportData, target: ReportTarget) =>
  target.kind === "standalone" ? [...target.hostIds] : machineOrder(data, target.hostIds);

/** Which machine of an AD set each of its findings is placed under: the machine of its first step logged on one of
 *  them, else the first of its machines in page order. */
function findingOwners(data: ReportData, machines: string[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const f of data.findings) {
    const mine = machines.filter((id) => f.hostIds.includes(id));
    if (mine.length === 0) continue;
    const steps = f.stepEntryIds
      .flatMap((id) => data.log.find((e) => e.id === id) ?? [])
      .sort(byTime);
    const first = steps.flatMap((e) => mine.filter((id) => e.hostIds.includes(id)))[0];
    owners.set(f.id, first ?? mine[0]);
  }
  return owners;
}

/** The machine and phase each of the target's findings is placed under by the draft; a finding
 *  that enabled no phase is `"additional"`. In an AD set a finding on several machines is placed once. */
export function findingPhaseMap(data: ReportData, target: ReportTarget): Map<string, { hostId: string; phase: Phase }> {
  const machines = machinesInOrder(data, target);
  const owner = target.kind === "standalone" ? null : findingOwners(data, machines);
  const out = new Map<string, { hostId: string; phase: Phase }>();
  for (const hostId of machines) {
    const owns = owner ? (f: string) => owner.get(f) === hostId : () => true;
    const { findings, phases } = hostPlan(data, hostId, hostEntry(data, target, hostId), target.kind === "standalone", owns);
    for (const f of findings) if (!out.has(f.id)) out.set(f.id, { hostId, phase: phases.get(f.id) ?? "additional" });
  }
  return out;
}

/** The machine of the target an entry is placed under (its first one in the target), and the phase it belongs to there:
 *  where its evidence goes. A screenshot that only came along with a placed entry takes that entry's phase. */
export function entryPhase(data: ReportData, target: ReportTarget, entry: LogEntry): { hostId: string; phase: Phase } {
  const hostId = entry.hostIds.find((h) => target.hostIds.includes(h)) ?? target.hostIds[0];
  const kept = keptEntries(data, hostId);
  const list = kept.some((e) => e.id === entry.id) ? kept : [...kept, entry];
  const how = hostEntry(data, target, hostId);
  const phase = phaseSplit(list, data, hostId, how, target.kind === "standalone").get(entry.id) ?? phaseNames(data, hostId, how)[0];
  return { hostId, phase };
}
