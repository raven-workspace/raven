import type { Finding } from "../../types/findings";
import type { LogEntry } from "../../types/log";
import { proofCompanions } from "./proof";
import { testedNotExploited } from "./coverage";
import { isDeadEnd, placingEntries } from "./prove";
import { isPortScan } from "./tools";
import { defaultKeep } from "./trim";
import type {
  EvidenceAttrs,
  ExploitAttrs,
  GeneratedAttrs,
  GeneratedKind,
  Phase,
  PhaseAttrs,
  PortsAttrs,
  ReportData,
  ReportMeta,
  ReportNode,
  ReportTarget,
  SlotAttrs,
  StepAttrs,
  VulnAttrs,
} from "./types";

/** How a screenshot taken after a kept entry still comes along with it. */
const SCREENSHOT_WINDOW_MS = 5 * 60_000;
/** A step's sentence slot: what the step does, then its evidence shows it. */
export const STEP_HINT = "Say what this step does";
/** A flag step's sentence slot. */
export const FLAG_STEP_HINT = "Say where you read the flag";
const EXPLOIT_HINT = "Explain each change";
/** The `steps` list's bold lead-in, printed by its view. Drafts no longer add a labelled reproduce slot. */
export const REPRODUCE_LABEL = "Steps to reproduce";
/** OffSec's sample order of a machine's sub-sections, then Raven's own: Additional findings, Also tested. */
const PHASE_ORDER: Phase[] = ["enum", "foothold", "lateral", "privesc", "domain", "post", "additional", "tested"];
/** Generated blocks that open a machine or close the AD set: a phase's region never runs past one. */
const REGION_BREAKS = new Set<GeneratedKind>(["facts", "port-scan", "attack-chain", "attack-path"]);

type HostEntry = "foothold" | "hop";

export const node = (type: string, attrs: object): ReportNode => ({ type, attrs: attrs as Record<string, unknown> });
export const slot = (hint: string, label?: string) => node("slot", (label ? { hint, label } : { hint }) satisfies SlotAttrs);
export const generated = (kind: GeneratedKind, hostId: string | null) =>
  node("generated", { kind, hostId, appendix: "inline" } satisfies GeneratedAttrs);
const phaseNode = (phase: Phase, hostId: string, findingId?: string) =>
  node("phase", (findingId ? { phase, hostId, findingId } : { phase, hostId }) satisfies PhaseAttrs);
/** A machine's port table, its Notes column empty. */
const portsNode = (hostId: string) => node("generated", { kind: "ports", hostId, appendix: "inline", notes: {} } satisfies PortsAttrs);

export const byTime = (a: LogEntry, b: LogEntry) => a.at - b.at || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

function lineCount(output: string): number {
  return output === "" ? 0 : output.replace(/\n$/, "").split("\n").length;
}

/**
 * The owner's own words from the log as page paragraphs they can edit: one per blank-line-separated paragraph, a single
 * line break kept as a hard break. Each keeps the entry it came from (`fromEntry`). A note's paragraphs are the note
 * on the page; an entry's observations (`fromField: "observations"`) are only words about it: its evidence block is
 * what places it.
 */
export function ownerParagraphs(text: string, entryId: string, fromField?: "observations"): ReportNode[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => ({
      type: "paragraph",
      attrs: fromField ? { fromEntry: entryId, fromField } : { fromEntry: entryId },
      content: p.split("\n").flatMap((line, i): ReportNode[] => [...(i > 0 ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]),
    }));
}

/** One evidence node per command block (or one for the whole entry). A note is the owner's own text: it lands as
 *  editable paragraphs, never a frozen block. */
export function evidenceBlocks(entry: LogEntry): ReportNode[] {
  if (entry.content.kind === "note") return ownerParagraphs(entry.content.text, entry.id);
  const placements: Pick<EvidenceAttrs, "block" | "keep">[] =
    entry.content.kind === "command" && entry.content.blocks.length > 0
      ? entry.content.blocks.map((b, i) => ({ block: i, keep: defaultKeep(lineCount(b.output)) }))
      : [{ block: null, keep: null }];
  return placements.map((p) => node("evidence", { entryId: entry.id, ...p, emphasis: [], appendix: "inline" } satisfies EvidenceAttrs));
}

/** An entry as one step: an empty slot first ("what you do next, and why"), then its evidence. A flag prints its own
 *  "Local.txt value:" line and takes no slot; a note is prose already. The entry's observations, when it has any,
 *  stand in for the empty slot as paragraphs the owner edits. */
export function evidenceNodes(entry: LogEntry): ReportNode[] {
  if (entry.kind === "flag" || entry.kind === "note") return evidenceBlocks(entry);
  const said = entry.observations?.trim() ? ownerParagraphs(entry.observations, entry.id, "observations") : [];
  return [...(said.length > 0 ? said : [slot(STEP_HINT)]), ...evidenceBlocks(entry)];
}

/**
 * One numbered step (§10.2): the owner's sentence (the lead entry's observations as paragraphs when it has any, else an
 * empty slot; a flag's slot asks where it was read; a note is prose already and takes none), then `extra` (exploit code,
 * read before the command that runs it), then each entry's evidence. `entries` is the step's entry, the screenshots
 * that came along with it and, for a flag, its companions; an empty list is a step the owner adds.
 */
export function stepNode(entries: LogEntry[], extra: ReportNode[] = []): ReportNode {
  const lead = entries[0] as LogEntry | undefined;
  const said = lead && lead.kind !== "note" && lead.observations?.trim() ? ownerParagraphs(lead.observations, lead.id, "observations") : [];
  const sentence = lead?.kind === "note" ? [] : said.length > 0 ? said : [slot(lead && isFlag(lead) ? FLAG_STEP_HINT : STEP_HINT)];
  return {
    type: "step",
    attrs: { entryId: lead?.id ?? null } satisfies StepAttrs,
    content: [...sentence, ...extra, ...entries.flatMap(evidenceBlocks)],
  };
}

/** A numbered Steps to reproduce list. Never empty. */
export const stepsNode = (steps: ReportNode[]): ReportNode => ({ type: "steps", content: steps });

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

const isFlag = (e: LogEntry | undefined) => e?.content.kind === "flag";

/** A finding file as the page shows it: the exploit, and for a modified one the slot explaining each change. */
const exploitNodes = (file: { id: string; modified: boolean }): ReportNode[] => [
  node("exploit", { fileId: file.id, markedLines: [], appendix: "inline" } satisfies ExploitAttrs),
  ...(file.modified ? [slot(EXPLOIT_HINT)] : []),
];

const baseName = (name: string) => name.split(/[\\/]/).pop()?.trim() ?? "";

/** Whether an entry's commands name a file by its base name (`python3 46153.py`). */
function namesFile(entry: LogEntry, fileName: string): boolean {
  const base = baseName(fileName);
  if (base === "" || entry.content.kind !== "command") return false;
  return entry.content.blocks.some((b) => (b.command ?? "").includes(base));
}

/**
 * Which of a phase's steps (their first entries, in order) an exploit file goes before: the first whose command names
 * the file, else the one that granted access, else none (its index is past the end: the end of the phase).
 */
function exploitStep(data: ReportData, hostId: string, fileName: string, leads: LogEntry[]): number {
  const named = leads.findIndex((e) => namesFile(e, fileName));
  if (named !== -1) return named;
  const granted = leads.findIndex((e) => data.grants.some((g) => g.hostId === hostId && g.logEntryId === e.id));
  return granted !== -1 ? granted : leads.length;
}

/** Entries in time order as steps: each placed entry with the screenshots that came along after it. */
function stepsOf(entries: LogEntry[], placing: ReadonlySet<string>): LogEntry[][] {
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
interface HostPlan {
  kept: LogEntry[];
  companions: Map<string, LogEntry[]>;
  split: Map<string, Phase>;
  placing: Set<string>;
  findings: Finding[];
  phases: Map<string, Phase | null>;
  time: Map<string, number>;
}

function hostPlan(data: ReportData, hostId: string, entry: HostEntry, enumerate: boolean, owns: (findingId: string) => boolean): HostPlan {
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

/** One machine's block in the sample's order (§10.2): its heading and Result line; Service Enumeration (the port table
 *  only, on every machine: port scans are never steps); the entry phase and privilege escalation, each
 *  told one finding per heading (the finding that enabled it, then one numbered steps list: a step per placed entry,
 *  screenshots joining the step before them, each exploit file inside the step that runs it, else the access step, else
 *  a step of its own; a second finding that enabled the same phase gets a heading of its own, with its own list); the
 *  local flag is the entry phase's last step; Post-Exploitation, the proof flag's step first; Additional findings
 *  (findings that enabled no phase, each under its own title); Also tested. A flag's step holds its companions. `owns`
 *  says which of the host's findings are placed here (in an AD set, a finding on several machines is placed once). */
function hostBlock(
  data: ReportData,
  hostId: string,
  entry: HostEntry,
  enumerate: boolean,
  owns: (findingId: string) => boolean = () => true,
): ReportNode[] {
  const { kept, companions, split, placing, findings, phases, time } = hostPlan(data, hostId, entry, enumerate, owns);
  const firstStep = (f: Finding) => Math.min(...f.stepEntryIds.map((id) => time.get(id) ?? Infinity), Infinity);
  const stepsIn = (phase: Phase) => stepsOf(kept.filter((e) => split.get(e.id) === phase), placing);
  // A flag's step: the flag, then its commands, then its screenshots (the ones that came along and its companions).
  const flagStep = ([flag, ...along]: LogEntry[]) => {
    const rest = [...along, ...(companions.get(flag.id) ?? [])];
    return stepNode([flag, ...rest.filter((e) => e.kind !== "screenshot"), ...rest.filter((e) => e.kind === "screenshot")]);
  };

  const out: ReportNode[] = [generated("facts", hostId), generated("result", hostId), phaseNode("enum", hostId), portsNode(hostId)];
  for (const phase of PHASE_ORDER) {
    if (!STEP_PHASES.has(phase)) continue;
    const steps = stepsIn(phase);
    const here = findings.filter((f) => phases.get(f.id) === phase).sort((a, b) => firstStep(a) - firstStep(b) || severityRank(a) - severityRank(b));
    if (steps.length === 0 && here.length === 0) continue;
    const walk = steps.filter((st) => !isFlag(st[0]));
    const flags = steps.filter((st) => isFlag(st[0]));
    // Each step goes under the finding whose step it is; a step of none, under the finding of the step before it.
    const groupOf: number[] = [];
    walk.forEach((st, i) => {
      const owner = here.findIndex((f, k) => k > 0 && st.some((e) => f.stepEntryIds.includes(e.id)));
      groupOf.push(owner !== -1 ? owner : i > 0 ? groupOf[i - 1] : 0);
    });
    const groups = here.length > 0 ? here.map((f, k) => ({ finding: f as Finding | null, k })) : [{ finding: null as Finding | null, k: 0 }];
    groups.forEach(({ finding: f, k }, g) => {
      out.push(k === 0 ? phaseNode(phase, hostId) : phaseNode(phase, hostId, f!.id));
      if (f) out.push(node("vuln", { findingId: f.id } satisfies VulnAttrs));
      const mine = walk.filter((_, i) => groupOf[i] === k);
      // Each exploit file goes inside the step that runs it, so the code is read before it is used.
      const inStep = new Map<number, ReportNode[]>();
      const own: ReportNode[] = [];
      for (const file of f ? data.findingFiles.filter((ff) => ff.findingId === f.id) : []) {
        const at = exploitStep(data, hostId, file.name, mine.map((st) => st[0]));
        if (at < mine.length) inStep.set(at, [...(inStep.get(at) ?? []), ...exploitNodes(file)]);
        else own.push(stepNode([], exploitNodes(file)));
      }
      const list = [...mine.map((step, i) => stepNode(step, inStep.get(i) ?? [])), ...own];
      // The local flag closes the phase: the last step of its last list.
      if (g === groups.length - 1) list.push(...flags.map(flagStep));
      if (list.length > 0) out.push(stepsNode(list));
    });
  }
  const post = stepsIn("post");
  if (post.length > 0) {
    out.push(phaseNode("post", hostId));
    out.push(stepsNode([...post.filter((st) => isFlag(st[0])).map(flagStep), ...post.filter((st) => !isFlag(st[0])).map((st) => stepNode(st))]));
  }
  const extra = findings.filter((f) => phases.get(f.id) == null).sort((a, b) => severityRank(a) - severityRank(b) || a.title.localeCompare(b.title));
  if (extra.length > 0) {
    out.push(phaseNode("additional", hostId));
    for (const f of extra) {
      out.push(phaseNode("additional", hostId, f.id), node("vuln", { findingId: f.id } satisfies VulnAttrs));
      for (const file of data.findingFiles.filter((ff) => ff.findingId === f.id)) out.push(...exploitNodes(file));
    }
  }
  if (testedNotExploited(data, hostId).length > 0) out.push(phaseNode("tested", hostId), generated("tested", hostId));
  return out;
}

const hostName = (data: ReportData, id: string) => data.hosts.find((h) => h.id === id)?.name ?? id;
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

/** A target's first draft, in OffSec's sample order (§5.7) with §10.2's short steps. Built once; the owner's page is
 *  the truth after that. `meta` is part of the contract for later rounds; nothing in the draft reads it yet. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildTargetDraft(data: ReportData, target: ReportTarget, _meta: ReportMeta): ReportNode {
  if (target.kind === "standalone") {
    return { type: "doc", content: hostBlock(data, target.hostIds[0], "foothold", true) };
  }
  const machines = machinesInOrder(data, target);
  const owner = findingOwners(data, machines);
  const content = [generated("attack-path", null)];
  for (const id of machines) content.push(...hostBlock(data, id, hostEntry(data, target, id), false, (f) => owner.get(f) === id));
  return { type: "doc", content };
}

/** The machine and phase each of the target's findings is placed under by the draft (`buildTargetDraft`); a finding
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

/** Every log entry placed on the page: an evidence node, a note's paragraphs, or a block edited on the page. */
export function evidenceIdsIn(doc: ReportNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: ReportNode) => {
    if (n.type === "evidence" && typeof n.attrs?.entryId === "string") ids.add(n.attrs.entryId);
    // A note's paragraphs and a block edited on the page place their entry; observations are provenance only.
    else if (typeof n.attrs?.fromEntry === "string" && n.attrs.fromEntry !== "" && n.attrs.fromField == null) ids.add(n.attrs.fromEntry);
    n.content?.forEach(walk);
  };
  walk(doc);
  return ids;
}

const isPhase = (n: ReportNode, hostId: string, phase?: Phase) =>
  n.type === "phase" && n.attrs?.hostId === hostId && (phase == null || n.attrs?.phase === phase);

/** The index just past a phase's region: up to the next heading or the next machine's block. */
function regionEnd(content: ReportNode[], phaseIndex: number): number {
  let j = phaseIndex + 1;
  while (
    j < content.length &&
    content[j].type !== "phase" &&
    !(content[j].type === "generated" && REGION_BREAKS.has(content[j].attrs?.kind as GeneratedKind) && content[j].attrs?.hostId !== content[phaseIndex].attrs?.hostId)
  ) {
    j++;
  }
  return j;
}

/** Where a missing phase heading goes: before the host's next phase in §5.7 order, else after its previous one. */
function placeForPhase(content: ReportNode[], hostId: string, phase: Phase): number {
  const rank = PHASE_ORDER.indexOf(phase);
  const rankOf = (n: ReportNode) => PHASE_ORDER.indexOf(n.attrs?.phase as Phase);
  const later = content.findIndex((n) => isPhase(n, hostId) && rankOf(n) > rank);
  if (later !== -1) return later;
  let earlier = -1;
  content.forEach((n, i) => {
    if (isPhase(n, hostId) && rankOf(n) < rank) earlier = i;
  });
  if (earlier !== -1) return regionEnd(content, earlier);
  const facts = content.findIndex((n) => n.type === "generated" && n.attrs?.kind === "facts" && n.attrs?.hostId === hostId);
  return facts === -1 ? content.length : facts + 1;
}

/** A path into the page: top-level index, then child indices. The last index is where nodes go in their parent. */
export type DocPath = number[];

/** `content` with `nodes` inserted at `path`; the nodes along the path are copied, nothing else is touched. */
function insertAtPath(content: ReportNode[], path: DocPath, nodes: ReportNode[]): ReportNode[] {
  const [i, ...rest] = path;
  if (rest.length === 0) return [...content.slice(0, i), ...nodes, ...content.slice(i)];
  const parent = content[i];
  return [...content.slice(0, i), { ...parent, content: insertAtPath(parent.content ?? [], rest, nodes) }, ...content.slice(i + 1)];
}

const evidenceEntry = (n: ReportNode, data: ReportData) =>
  n.type === "evidence" ? data.log.find((l) => l.id === n.attrs?.entryId) : undefined;

/** The step on the page that holds an entry's evidence (or was drafted from it), as [list index, step index]. */
function stepPath(content: ReportNode[], entryId: string): DocPath | null {
  for (let i = 0; i < content.length; i++) {
    if (content[i].type !== "steps") continue;
    const k = (content[i].content ?? []).findIndex(
      (s) => s.attrs?.entryId === entryId || (s.content ?? []).some((n) => n.type === "evidence" && n.attrs?.entryId === entryId),
    );
    if (k !== -1) return [i, k];
  }
  return null;
}

/**
 * Where a new step goes on a page with no cursor (§5.1, §10.2): in its phase's steps list (the heading and its list
 * added when the page has none), at the end, except that a proof flag's step opens Post-Exploitation's list, a step of
 * the entry phase goes before its local flag's step, and a step that runs an exploit on the page goes right after the
 * step holding it. Under a heading with no list yet, a list is made after the heading's vulnerability (or the port
 * table under Service Enumeration).
 */
function placeEntry(content: ReportNode[], data: ReportData, hostId: string, entry: LogEntry, phase: Phase): { at: DocPath; nodes: ReportNode[] } {
  const nodes = [stepNode([entry])];
  const first = content.findIndex((n) => isPhase(n, hostId, phase));
  if (first === -1) return { at: [placeForPhase(content, hostId, phase)], nodes: [phaseNode(phase, hostId), stepsNode(nodes)] };
  const opens = phase === "post" && isFlag(entry);
  // The heading of the finding the step belongs to (a second finding that enabled the phase has its own), else the
  // phase's last one: new steps go at the phase's end. A proof flag opens the phase.
  const headings = content.flatMap((n, i) => (isPhase(n, hostId, phase) ? [i] : []));
  const findingAt = (i: number) =>
    (content[i].attrs?.findingId as string | null | undefined) ?? (content[i + 1]?.type === "vuln" ? (content[i + 1].attrs?.findingId as string) : null);
  const owner = headings.find((i) => {
    const id = findingAt(i);
    return id != null && (data.findings.find((f) => f.id === id)?.stepEntryIds.includes(entry.id) ?? false);
  });
  const heading = opens ? first : (owner ?? headings[headings.length - 1]);
  const end = regionEnd(content, heading);
  const lists = content.slice(heading + 1, end).flatMap((n, j) => (n.type === "steps" ? [heading + 1 + j] : []));
  if (lists.length === 0) {
    let at = heading + 1;
    while (at < end && (content[at].type === "vuln" || (content[at].type === "generated" && content[at].attrs?.kind === "ports"))) at++;
    return { at: [at], nodes: [stepsNode(nodes)] };
  }
  const listAt = opens ? lists[0] : lists[lists.length - 1];
  const steps = content[listAt].content ?? [];
  if (opens) return { at: [listAt, 0], nodes };

  // A step that runs an exploit on the page goes right after the step holding it, when no step runs it yet.
  const entriesOf = (s: ReportNode) => (s.content ?? []).flatMap((n) => evidenceEntry(n, data) ?? []);
  const filesOf = (s: ReportNode) => (s.content ?? []).flatMap((n) => (n.type === "exploit" ? (data.findingFiles.find((f) => f.id === n.attrs?.fileId) ?? []) : []));
  const holder = steps.findIndex((s) =>
    filesOf(s).some((file) => namesFile(entry, file.name) && !steps.some((t) => entriesOf(t).some((e) => namesFile(e, file.name)))),
  );
  if (holder !== -1) return { at: [listAt, holder + 1], nodes };
  if (phase !== "post" && !isFlag(entry)) {
    const flagAt = steps.findIndex((s) => isFlag(data.log.find((l) => l.id === s.attrs?.entryId)) || entriesOf(s).some(isFlag));
    if (flagAt !== -1) return { at: [listAt, flagAt], nodes };
  }
  return { at: [listAt, steps.length], nodes };
}

/**
 * Appends entries that now qualify, are not on the page and were not removed: each as a new step in its phase's list
 * (creating the heading and list if missing), a screenshot that came along with a step on the page into that step, a
 * flag's companion into the flag's step. Never removes or reorders anything.
 */
export function addNewEvidence(
  doc: ReportNode,
  data: ReportData,
  target: ReportTarget,
  _meta: ReportMeta,
  removed: string[],
): { doc: ReportNode; added: string[]; addedTested: string[] } {
  const skip = new Set([...evidenceIdsIn(doc), ...removed]);
  let content = [...(doc.content ?? [])];
  const added: string[] = [];
  const addedTested: string[] = [];

  for (const hostId of machinesInOrder(data, target)) {
    const { kept, companions, split, placing } = hostPlan(data, hostId, hostEntry(data, target, hostId), target.kind === "standalone", () => true);
    kept.forEach((e, i) => {
      if (skip.has(e.id)) return;
      let placed: { at: DocPath; nodes: ReportNode[] } | null = null;
      if (e.kind === "screenshot" && !placing.has(e.id)) {
        // It came along with the entry logged before it: into that entry's step, when the page has it. Never across a
        // phase: the walk stops at the first earlier entry of another phase, and the screenshot goes to its own phase.
        for (let j = i - 1; j >= 0 && placed == null; j--) {
          if (split.get(kept[j].id) !== split.get(e.id)) break;
          const path = stepPath(content, kept[j].id);
          if (path) placed = { at: [...path, (content[path[0]].content![path[1]].content ?? []).length], nodes: evidenceBlocks(e) };
        }
      }
      placed ??= placeEntry(content, data, hostId, e, split.get(e.id)!);
      content = insertAtPath(content, placed.at, placed.nodes);
      skip.add(e.id);
      added.push(e.id);
    });
    // A flag's companions not on the page yet go into its step as a fresh draft orders it: commands, then screenshots.
    for (const [flagId, list] of companions) {
      for (const e of list.filter((x) => !skip.has(x.id))) {
        const at = companionPlace(content, flagId, data, e);
        if (at == null) continue;
        content = insertAtPath(content, at, evidenceBlocks(e));
        skip.add(e.id);
        added.push(e.id);
      }
    }
    // Items tried and failed since the draft: the Also tested heading and its list, where the page has none.
    if (testedNotExploited(data, hostId).length > 0 && !content.some((n) => isPhase(n, hostId, "tested"))) {
      content = insertAtPath(content, [placeForPhase(content, hostId, "tested")], [phaseNode("tested", hostId), generated("tested", hostId)]);
      addedTested.push(hostId);
    }
  }
  const changed = added.length > 0 || addedTested.length > 0;
  return { doc: changed ? { ...doc, content } : doc, added, addedTested };
}

/**
 * Where a companion goes in its flag's step on the page, as a fresh draft orders it (the flag, its commands, then its
 * screenshots): a command after the flag and the step's commands, a screenshot at the end of them. Null when the flag
 * is not on the page.
 */
function companionPlace(content: ReportNode[], flagId: string, data: ReportData, entry: LogEntry): DocPath | null {
  const path = stepPath(content, flagId);
  if (!path) return null;
  const kids = content[path[0]].content![path[1]].content ?? [];
  const at = kids.findIndex((n) => n.type === "evidence" && n.attrs?.entryId === flagId);
  if (at === -1) return null;
  const flag = data.log.find((e) => e.id === flagId);
  const ids = new Set(flag ? flag.hostIds.flatMap((h) => blockCompanions(data, h, flag).map((c) => c.id)) : []);
  const kindAt = (j: number) => evidenceEntry(kids[j], data)?.kind;
  let j = at + 1;
  while (j < kids.length && kids[j].type === "evidence" && (kids[j].attrs?.entryId === flagId || ids.has(String(kids[j].attrs?.entryId)))) {
    if (entry.kind !== "screenshot" && kids[j].attrs?.entryId !== flagId && kindAt(j) === "screenshot") break;
    j++;
  }
  return [...path, j];
}

/** The machine of the target an entry is placed under (its first one in the target), and the phase it belongs to there:
 *  where `endOfPhase` puts it. A screenshot that only came along with a placed entry takes that entry's phase. */
export function entryPhase(data: ReportData, target: ReportTarget, entry: LogEntry): { hostId: string; phase: Phase } {
  const hostId = entry.hostIds.find((h) => target.hostIds.includes(h)) ?? target.hostIds[0];
  const kept = keptEntries(data, hostId);
  const list = kept.some((e) => e.id === entry.id) ? kept : [...kept, entry];
  const how = hostEntry(data, target, hostId);
  const phase = phaseSplit(list, data, hostId, how, target.kind === "standalone").get(entry.id) ?? phaseNames(data, hostId, how)[0];
  return { hostId, phase };
}

/** Where an entry goes when the page has no cursor (§5.1, §10.1): a new step at the end of its phase (`placeEntry`).
 *  `at` is a path (`DocPath`). A flag's companion goes into the flag's step when the flag is on the page. A screenshot
 *  that only came along with a placed entry joins a step, as `addNewEvidence` places it: the step holding the entry
 *  logged before it, else the last step of its phase's list; a new step only when that list has none. */
export function endOfPhase(doc: ReportNode, data: ReportData, target: ReportTarget, entry: LogEntry): { at: DocPath; nodes: ReportNode[] } {
  const { hostId, phase } = entryPhase(data, target, entry);
  const content = doc.content ?? [];
  const kept = keptEntries(data, hostId);
  for (const [flagId, list] of flagCompanions(data, hostId, kept)) {
    if (!list.some((e) => e.id === entry.id)) continue;
    const at = companionPlace(content, flagId, data, entry);
    if (at != null) return { at, nodes: evidenceBlocks(entry) };
  }
  const placed = placeEntry(content, data, hostId, entry, phase);
  if (entry.kind === "screenshot" && !placingEntries(data, hostId).has(entry.id)) {
    const endOf = (path: DocPath): DocPath => [...path, (content[path[0]].content![path[1]].content ?? []).length];
    // The walk back stops at the first earlier entry of another phase, as `addNewEvidence`'s does.
    const before = kept.filter((e) => e.id !== entry.id && byTime(e, entry) < 0).reverse();
    for (const e of before) {
      if (entryPhase(data, target, e).phase !== phase) break;
      const path = stepPath(content, e.id);
      if (path) return { at: endOf(path), nodes: evidenceBlocks(entry) };
    }
    // The step placeEntry would add goes into a list at `[list, k]`: the step before it is the phase's last one.
    const [listAt, k] = placed.at;
    if (placed.at.length === 2 && k > 0) return { at: endOf([listAt, k - 1]), nodes: evidenceBlocks(entry) };
  }
  return placed;
}
