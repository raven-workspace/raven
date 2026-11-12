import type { Finding } from "../../types/findings";
import type { LogEntry } from "../../types/log";
import { proofCompanions } from "./proof";
import { testedNotExploited } from "./coverage";
import { isDeadEnd, provingEntries } from "./prove";
import { isPortScan } from "./tools";
import { defaultKeep } from "./trim";
import type {
  EvidenceAttrs,
  ExploitAttrs,
  GeneratedAttrs,
  GeneratedKind,
  Phase,
  PhaseAttrs,
  ReportData,
  ReportMeta,
  ReportNode,
  ReportTarget,
  SlotAttrs,
  VulnAttrs,
} from "./types";

/** How a screenshot taken after a kept entry still comes along with it. */
const SCREENSHOT_WINDOW_MS = 5 * 60_000;
/** The slot before each step: the sample's walkthrough explains what comes next, then shows it. */
export const STEP_HINT = "What you do next, and why";
const EXPLOIT_HINT = "Explain each change";
const REPRODUCE_HINT = "A short summary of the attack, start to finish";
export const REPRODUCE_LABEL = "Steps to reproduce the attack:";
/** OffSec's sample order of a machine's sub-sections, then Raven's own: Additional findings, Also tested. */
const PHASE_ORDER: Phase[] = ["enum", "foothold", "lateral", "privesc", "domain", "post", "additional", "tested"];
/** Generated blocks that open a machine or close the AD set: a phase's region never runs past one. */
const REGION_BREAKS = new Set<GeneratedKind>(["facts", "port-scan", "attack-chain"]);

type HostEntry = "foothold" | "hop";

export const node = (type: string, attrs: object): ReportNode => ({ type, attrs: attrs as Record<string, unknown> });
export const slot = (hint: string, label?: string) => node("slot", (label ? { hint, label } : { hint }) satisfies SlotAttrs);
export const generated = (kind: GeneratedKind, hostId: string | null) =>
  node("generated", { kind, hostId, appendix: "inline" } satisfies GeneratedAttrs);
const phaseNode = (phase: Phase, hostId: string, findingId?: string) =>
  node("phase", (findingId ? { phase, hostId, findingId } : { phase, hostId }) satisfies PhaseAttrs);

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

/** The host's entries that land on the page, in time order: proving ones (notes aside), and screenshots taken
 *  between two of them or within a few minutes after one (each goes with the proving entry before it). */
function keptEntries(data: ReportData, hostId: string): LogEntry[] {
  const proving = provingEntries(data, hostId);
  const proven = data.log.filter((e) => proving.has(e.id) && e.kind !== "note");
  const shots = data.log.filter(
    (e) =>
      e.kind === "screenshot" &&
      !proving.has(e.id) &&
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
function hostEntry(data: ReportData, target: ReportTarget, hostId: string): HostEntry {
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
 * post-exploitation. With no boundary, every step is the entry phase. A screenshot that only came along with a proving
 * entry takes that entry's phase (the proving entry logged before it).
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

  const proving = provingEntries(data, hostId);
  const out = new Map<string, Phase>();
  let anchor: Phase | null = null;
  sorted.forEach((e, i) => {
    if (e.kind === "screenshot" && !proving.has(e.id)) {
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

const isFlag = (e: LogEntry) => e.content.kind === "flag";

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

/** Entries in time order as steps: each proving entry with the screenshots that came along after it. */
function stepsOf(entries: LogEntry[], proving: Map<string, unknown>): LogEntry[][] {
  const steps: LogEntry[][] = [];
  for (const e of entries) {
    const tagsAlong = e.kind === "screenshot" && !proving.has(e.id) && steps.length > 0;
    if (tagsAlong) steps[steps.length - 1].push(e);
    else steps.push([e]);
  }
  return steps;
}

/** A step on the page: one slot before all its evidence; a flag's step prints its own label and takes none. */
const stepNodes = (step: LogEntry[]): ReportNode[] => [...(isFlag(step[0]) ? [] : [slot(STEP_HINT)]), ...step.flatMap(evidenceBlocks)];

/** The order findings are told in: most severe first, unrated after rated ones, info last; then by title. */
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const severityRank = (f: Finding) => (f.severity == null ? 4 : f.severity === "info" ? 5 : SEVERITY_RANK[f.severity]);
/** Observations: they never enable a phase, whatever steps they link. */
const isObservation = (f: Finding) => f.severity === "info" || f.severity === "low";

/**
 * A flag's companions (`proofCompanions`) the page shows in the flag's block. A proving entry (a finding's step, an
 * access step, a goal's evidence) stays in its phase: its text still counts for the proof, but it is never moved.
 */
export function blockCompanions(data: ReportData, hostId: string, flag: LogEntry): LogEntry[] {
  const proving = provingEntries(data, hostId);
  return proofCompanions(data, hostId, flag).filter((c) => !proving.has(c.id) && !isFlag(c));
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
 * SeImpersonate, sudo, SUID…); among equals, the one whose words fit, then the oldest.
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
  const fill = (phase: Phase, privesc: boolean) => {
    if ([...out.values()].includes(phase)) return;
    const fits = (f: Finding) => readsPrivesc(f) === privesc;
    const pick = unlinked
      .filter((f) => out.get(f.id) == null && (privesc ? fits(f) : true))
      .sort((a, b) => severityRank(a) - severityRank(b) || Number(fits(b)) - Number(fits(a)) || a.createdAt - b.createdAt)[0];
    if (pick) out.set(pick.id, phase);
  };
  // Privilege escalation first, so a privesc-worded finding never opens the entry phase when another one could.
  if (second !== entryPhase) fill(second, true);
  fill(entryPhase, false);
  return out;
}

const STEP_PHASES = new Set<Phase>(["foothold", "lateral", "privesc", "domain"]);

/** One machine's block in the sample's order: its heading; Service Enumeration (standalone: the Port Scan Results
 *  table and the scans); the entry phase and privilege escalation, each told one finding per heading (the finding that
 *  enabled it, then its reproduce slot, walkthrough and exploits; a second finding that enabled the same phase gets a
 *  heading of its own, with its own steps); the local flag closes the entry phase; Post-Exploitation, the proof flag
 *  first; Additional findings (findings that enabled no phase, each under its own title); Also tested. A flag's block
 *  holds its companions. `owns` says which of the host's findings are placed here (in an AD set, a finding on several
 *  machines is placed once). */
function hostBlock(
  data: ReportData,
  hostId: string,
  entry: HostEntry,
  enumerate: boolean,
  owns: (findingId: string) => boolean = () => true,
): ReportNode[] {
  const all = keptEntries(data, hostId);
  const companions = flagCompanions(data, hostId, all);
  const moved = new Set([...companions.values()].flat().map((e) => e.id));
  const kept = all.filter((e) => !moved.has(e.id));
  const split = phaseSplit(kept, data, hostId, entry, enumerate);
  const proving = provingEntries(data, hostId);
  const time = new Map(kept.map((e) => [e.id, e.at]));

  const findings = data.findings.filter((f) => f.hostIds.includes(hostId) && owns(f.id));
  const phases = findingPhases(findings, split, time, phaseNames(data, hostId, entry));
  const firstStep = (f: Finding) => Math.min(...f.stepEntryIds.map((id) => time.get(id) ?? Infinity), Infinity);
  const stepsIn = (phase: Phase) => stepsOf(kept.filter((e) => split.get(e.id) === phase), proving);
  const flagNodes = (step: LogEntry[]) => [...stepNodes(step), ...(companions.get(step[0].id) ?? []).flatMap(evidenceBlocks)];

  const out: ReportNode[] = [generated("facts", hostId)];
  if (enumerate) out.push(phaseNode("enum", hostId), generated("port-scan", hostId), ...stepsIn("enum").flatMap(stepNodes));
  for (const phase of PHASE_ORDER) {
    if (!STEP_PHASES.has(phase)) continue;
    const steps = stepsIn(phase);
    const here = findings.filter((f) => phases.get(f.id) === phase).sort((a, b) => firstStep(a) - firstStep(b) || severityRank(a) - severityRank(b));
    if (steps.length === 0 && here.length === 0) continue;
    const walk = steps.filter((st) => !isFlag(st[0]));
    // Each step goes under the finding whose step it is; a step of none, under the finding of the step before it.
    const groupOf: number[] = [];
    walk.forEach((st, i) => {
      const owner = here.findIndex((f, k) => k > 0 && st.some((e) => f.stepEntryIds.includes(e.id)));
      groupOf.push(owner !== -1 ? owner : i > 0 ? groupOf[i - 1] : 0);
    });
    const groups = here.length > 0 ? here.map((f, k) => ({ finding: f as Finding | null, k })) : [{ finding: null as Finding | null, k: 0 }];
    for (const { finding: f, k } of groups) {
      out.push(k === 0 ? phaseNode(phase, hostId) : phaseNode(phase, hostId, f!.id));
      if (f) out.push(node("vuln", { findingId: f.id } satisfies VulnAttrs));
      const mine = walk.filter((_, i) => groupOf[i] === k);
      if (f || mine.length > 0) out.push(slot(REPRODUCE_HINT, REPRODUCE_LABEL));
      // Each exploit file goes just before the step that runs it, so the code is read before it is used.
      const before = new Map<number, ReportNode[]>();
      for (const file of f ? data.findingFiles.filter((ff) => ff.findingId === f.id) : []) {
        const at = exploitStep(data, hostId, file.name, mine.map((st) => st[0]));
        before.set(at, [...(before.get(at) ?? []), ...exploitNodes(file)]);
      }
      mine.forEach((step, i) => out.push(...(before.get(i) ?? []), ...stepNodes(step)));
      out.push(...(before.get(mine.length) ?? []));
    }
    for (const step of steps) if (isFlag(step[0])) out.push(...flagNodes(step));
  }
  const post = stepsIn("post");
  if (post.length > 0) {
    out.push(phaseNode("post", hostId));
    for (const step of post) if (isFlag(step[0])) out.push(...flagNodes(step));
    for (const step of post) if (!isFlag(step[0])) out.push(...stepNodes(step));
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

const machinesInOrder = (data: ReportData, target: ReportTarget) =>
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

/** A target's first draft, in OffSec's sample order (§5.7). Built once; the owner's page is the truth after that.
 *  `meta` is part of the contract for later rounds; nothing in the draft reads it yet. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildTargetDraft(data: ReportData, target: ReportTarget, _meta: ReportMeta): ReportNode {
  if (target.kind === "standalone") {
    return { type: "doc", content: hostBlock(data, target.hostIds[0], "foothold", true) };
  }
  const machines = machinesInOrder(data, target);
  const owner = findingOwners(data, machines);
  const content = [generated("port-scan", null)];
  for (const id of machines) content.push(...hostBlock(data, id, hostEntry(data, target, id), false, (f) => owner.get(f) === id));
  content.push(generated("attack-chain", null));
  return { type: "doc", content };
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

/**
 * Where an entry goes on a page with no cursor (§5.1): in its phase (the heading added in front when the page has none),
 * at the end of it, except that a proof flag opens Post-Exploitation and a step of the entry phase goes before its local
 * flag. A screenshot that only came along with a step takes no slot of its own.
 */
function placeEntry(
  content: ReportNode[],
  data: ReportData,
  hostId: string,
  entry: LogEntry,
  phase: Phase,
): { at: number; nodes: ReportNode[] } {
  const tagsAlong = entry.kind === "screenshot" && !provingEntries(data, hostId).has(entry.id);
  const nodes = tagsAlong ? evidenceBlocks(entry) : evidenceNodes(entry);
  const first = content.findIndex((n) => isPhase(n, hostId, phase));
  if (first === -1) return { at: placeForPhase(content, hostId, phase), nodes: [phaseNode(phase, hostId), ...nodes] };
  if (phase === "post" && isFlag(entry)) return { at: first + 1, nodes };
  // The heading of the finding the step belongs to (a second finding that enabled the phase has its own), else the
  // phase's last one: new steps go at the phase's end.
  const headings = content.flatMap((n, i) => (isPhase(n, hostId, phase) ? [i] : []));
  const findingAt = (i: number) =>
    (content[i].attrs?.findingId as string | null | undefined) ?? (content[i + 1]?.type === "vuln" ? (content[i + 1].attrs?.findingId as string) : null);
  const owner = headings.find((i) => {
    const id = findingAt(i);
    return id != null && (data.findings.find((f) => f.id === id)?.stepEntryIds.includes(entry.id) ?? false);
  });
  const heading = owner ?? headings[headings.length - 1];
  const end = regionEnd(content, heading);
  // A step that runs an exploit on the page goes right after it (and its explanation), when no step runs it yet.
  const region = content.slice(heading + 1, end);
  const fileOf = (n: ReportNode) => (n.type === "exploit" ? data.findingFiles.find((f) => f.id === n.attrs?.fileId) : undefined);
  const exploitAt = region.findIndex((n) => {
    const file = fileOf(n);
    return file != null && namesFile(entry, file.name);
  });
  if (exploitAt !== -1) {
    const file = fileOf(region[exploitAt])!;
    let at = heading + 1 + exploitAt + 1;
    if (content[at]?.type === "slot" && content[at].attrs?.hint === EXPLOIT_HINT) at++;
    const runs = content.slice(at, end).some((n) => {
      const e = n.type === "evidence" ? data.log.find((l) => l.id === n.attrs?.entryId) : undefined;
      return e != null && namesFile(e, file.name);
    });
    if (!runs) return { at, nodes };
  }
  if (phase !== "post" && !isFlag(entry)) {
    const flagAt = content.slice(heading + 1, end).findIndex((n) => {
      const e = n.type === "evidence" ? data.log.find((l) => l.id === n.attrs?.entryId) : undefined;
      return e != null && isFlag(e);
    });
    if (flagAt !== -1) return { at: heading + 1 + flagAt, nodes };
  }
  return { at: end, nodes };
}

/**
 * Appends entries that now qualify, are not on the page and were not removed, each to its phase (creating the heading
 * if missing), each step with an empty slot before it. Never removes or reorders anything.
 */
export function addNewEvidence(
  doc: ReportNode,
  data: ReportData,
  target: ReportTarget,
  _meta: ReportMeta,
  removed: string[],
): { doc: ReportNode; added: string[]; addedTested: string[] } {
  const skip = new Set([...evidenceIdsIn(doc), ...removed]);
  const content = [...(doc.content ?? [])];
  const added: string[] = [];
  const addedTested: string[] = [];

  for (const hostId of machinesInOrder(data, target)) {
    const all = keptEntries(data, hostId);
    const companions = flagCompanions(data, hostId, all);
    const moved = new Set([...companions.values()].flat().map((e) => e.id));
    const kept = all.filter((e) => !moved.has(e.id));
    const split = phaseSplit(kept, data, hostId, hostEntry(data, target, hostId), target.kind === "standalone");
    for (const e of kept) {
      if (skip.has(e.id)) continue;
      const { at, nodes } = placeEntry(content, data, hostId, e, split.get(e.id)!);
      content.splice(at, 0, ...nodes);
      skip.add(e.id);
      added.push(e.id);
    }
    // A flag's companions not on the page yet go into its block as a fresh draft orders it: commands, then screenshots.
    for (const [flagId, list] of companions) {
      for (const e of list.filter((x) => !skip.has(x.id))) {
        const at = companionPlace(content, flagId, data, e);
        if (at === -1) continue;
        content.splice(at, 0, ...evidenceBlocks(e));
        skip.add(e.id);
        added.push(e.id);
      }
    }
    // Items tried and failed since the draft: the Also tested heading and its list, where the page has none.
    if (testedNotExploited(data, hostId).length > 0 && !content.some((n) => isPhase(n, hostId, "tested"))) {
      content.splice(placeForPhase(content, hostId, "tested"), 0, phaseNode("tested", hostId), generated("tested", hostId));
      addedTested.push(hostId);
    }
  }
  const changed = added.length > 0 || addedTested.length > 0;
  return { doc: changed ? { ...doc, content } : doc, added, addedTested };
}

/**
 * Where a companion goes in its flag's block on the page, as a fresh draft orders the block (the flag, its commands,
 * then its screenshots): a command after the flag and the block's commands, a screenshot at the block's end. -1 when
 * the flag is not on the page.
 */
function companionPlace(content: ReportNode[], flagId: string, data: ReportData, entry: LogEntry): number {
  const at = content.findIndex((n) => n.type === "evidence" && n.attrs?.entryId === flagId);
  if (at === -1) return -1;
  const flag = data.log.find((e) => e.id === flagId);
  const ids = new Set(flag ? flag.hostIds.flatMap((h) => blockCompanions(data, h, flag).map((c) => c.id)) : []);
  const kindAt = (j: number) => data.log.find((e) => e.id === content[j].attrs?.entryId)?.kind;
  let j = at + 1;
  while (j < content.length && content[j].type === "evidence" && (content[j].attrs?.entryId === flagId || ids.has(String(content[j].attrs?.entryId)))) {
    if (entry.kind !== "screenshot" && content[j].attrs?.entryId !== flagId && kindAt(j) === "screenshot") break;
    j++;
  }
  return j;
}

/** Where an entry goes when the page has no cursor (§5.1); `at` is an index into the doc's top-level content. A flag's
 *  companion goes into the flag's block when the flag is on the page. */
export function endOfPhase(doc: ReportNode, data: ReportData, target: ReportTarget, entry: LogEntry): { at: number; nodes: ReportNode[] } {
  const hostId = entry.hostIds.find((h) => target.hostIds.includes(h)) ?? target.hostIds[0];
  const content = doc.content ?? [];
  for (const [flagId, list] of flagCompanions(data, hostId, keptEntries(data, hostId))) {
    if (!list.some((e) => e.id === entry.id)) continue;
    const at = companionPlace(content, flagId, data, entry);
    if (at !== -1) return { at, nodes: evidenceBlocks(entry) };
  }
  const kept = keptEntries(data, hostId);
  const list = kept.some((e) => e.id === entry.id) ? kept : [...kept, entry];
  const how = hostEntry(data, target, hostId);
  const phase = phaseSplit(list, data, hostId, how, target.kind === "standalone").get(entry.id) ?? phaseNames(data, hostId, how)[0];
  return placeEntry(doc.content ?? [], data, hostId, entry, phase);
}
