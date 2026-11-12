import type { LogEntry } from "../../types/log";
import { isDeadEnd, provingEntries } from "./prove";
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
const STEP_HINT = "What this shows, and why it matters";
const EXPLOIT_HINT = "Explain each change";
/** §5.7 order of a target's sub-sections. */
const PHASE_ORDER: Phase[] = ["foothold", "lateral", "privesc", "domain", "tested", "proof"];
/** Generated blocks that open a machine or the AD set: a phase's region never runs past one. */
const REGION_BREAKS = new Set<GeneratedKind>(["facts", "ad-overview", "attack-chain"]);

type HostEntry = "foothold" | "hop";

export const node = (type: string, attrs: object): ReportNode => ({ type, attrs: attrs as Record<string, unknown> });
export const slot = (hint: string) => node("slot", { hint } satisfies SlotAttrs);
export const generated = (kind: GeneratedKind, hostId: string | null) =>
  node("generated", { kind, hostId, appendix: "inline" } satisfies GeneratedAttrs);
const phaseNode = (phase: Phase, hostId: string) => node("phase", { phase, hostId } satisfies PhaseAttrs);

export const byTime = (a: LogEntry, b: LogEntry) => a.at - b.at || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

function lineCount(output: string): number {
  return output === "" ? 0 : output.replace(/\n$/, "").split("\n").length;
}

/** One evidence node per command block (or one for the whole entry), each followed by an empty slot. */
function evidenceNodes(entry: LogEntry): ReportNode[] {
  const placements: Pick<EvidenceAttrs, "block" | "keep">[] =
    entry.content.kind === "command" && entry.content.blocks.length > 0
      ? entry.content.blocks.map((b, i) => ({ block: i, keep: defaultKeep(lineCount(b.output)) }))
      : [{ block: null, keep: null }];
  return placements.flatMap((p) => [
    node("evidence", { entryId: entry.id, ...p, emphasis: [], appendix: "inline" } satisfies EvidenceAttrs),
    slot(STEP_HINT),
  ]);
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
 * §5.1: entries up to and including the first access on the host (a grant, the first local flag, or the hop that
 * entered it) are the entry phase; the rest are privilege escalation (domain compromise on the DC); flags are proof.
 * With no boundary, every non-flag entry is the entry phase. A screenshot that only came along with a proving entry
 * takes that entry's phase (the proving entry logged before it).
 */
export function phaseSplit(entries: LogEntry[], data: ReportData, hostId: string, entry: HostEntry): Map<string, Phase> {
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

  const candidates: number[] = [];
  for (const g of data.grants) if (g.hostId === hostId) candidates.push(indexOf(g.logEntryId, g.at));
  if (entry === "hop") {
    for (const h of data.hops) if (h.toHostId === hostId) candidates.push(indexOf(h.logEntryId, h.at));
  }
  sorted.forEach((e, i) => {
    if (e.content.kind === "flag" && e.content.flagKind === "local") candidates.push(i);
  });
  const found = candidates.filter((i) => i !== -1);
  const boundary = found.length > 0 ? Math.min(...found) : Infinity;

  const proving = provingEntries(data, hostId);
  const out = new Map<string, Phase>();
  let anchor: Phase | null = null;
  sorted.forEach((e, i) => {
    if (e.kind === "screenshot" && !proving.has(e.id)) {
      out.set(e.id, anchor ?? first);
      return;
    }
    const phase = e.kind === "flag" ? "proof" : i <= boundary ? first : second;
    out.set(e.id, phase);
    anchor = phase;
  });
  return out;
}

/** One machine's block: facts, services, its step phases, tested-not-exploited, proof. */
function hostBlock(data: ReportData, hostId: string, entry: HostEntry): ReportNode[] {
  const kept = keptEntries(data, hostId);
  const split = phaseSplit(kept, data, hostId, entry);
  const entryPhase = phaseNames(data, hostId, entry)[0];
  const time = new Map(kept.map((e) => [e.id, e.at]));

  const findings = data.findings.filter((f) => f.hostIds.includes(hostId));
  const findingPhase = (stepIds: string[]): Phase => {
    const steps = stepIds.filter((id) => split.has(id) && split.get(id) !== "proof");
    steps.sort((a, b) => (time.get(a) ?? 0) - (time.get(b) ?? 0));
    return steps.length > 0 ? split.get(steps[0])! : entryPhase;
  };
  const placed = findings.map((f) => ({ finding: f, phase: findingPhase(f.stepEntryIds) }));

  const out: ReportNode[] = [generated("facts", hostId), generated("services", hostId)];
  for (const phase of PHASE_ORDER) {
    if (phase === "tested" || phase === "proof") continue;
    const steps = kept.filter((e) => split.get(e.id) === phase);
    const here = placed.filter((p) => p.phase === phase).map((p) => p.finding);
    if (steps.length === 0 && here.length === 0) continue;
    out.push(phaseNode(phase, hostId));
    for (const f of here) out.push(node("vuln", { findingId: f.id } satisfies VulnAttrs));
    for (const e of steps) out.push(...evidenceNodes(e));
    for (const f of here) {
      for (const file of data.findingFiles.filter((ff) => ff.findingId === f.id)) {
        out.push(node("exploit", { fileId: file.id, markedLines: [], appendix: "inline" } satisfies ExploitAttrs));
        if (file.modified) out.push(slot(EXPLOIT_HINT));
      }
    }
  }
  out.push(phaseNode("tested", hostId), generated("tested", hostId));
  out.push(phaseNode("proof", hostId), generated("proof-table-host", hostId));
  for (const e of kept) if (split.get(e.id) === "proof") out.push(...evidenceNodes(e));
  return out;
}

const hostName = (data: ReportData, id: string) => data.hosts.find((h) => h.id === id)?.name ?? id;
const machinesInOrder = (data: ReportData, target: ReportTarget) =>
  [...target.hostIds].sort((a, b) => hostName(data, a).localeCompare(hostName(data, b)));

/** A target's first draft, in the §5.7 per-target order. Built once; the owner's page is the truth after that.
 *  `meta` is part of the contract for later rounds; nothing in the draft reads it yet. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildTargetDraft(data: ReportData, target: ReportTarget, _meta: ReportMeta): ReportNode {
  if (target.kind === "standalone") {
    return { type: "doc", content: hostBlock(data, target.hostIds[0], "foothold") };
  }
  const content = [generated("ad-overview", null)];
  for (const id of machinesInOrder(data, target)) content.push(...hostBlock(data, id, hostEntry(data, target, id)));
  content.push(generated("attack-chain", null));
  return { type: "doc", content };
}

/** Every log entry an evidence node on the page refers to. */
export function evidenceIdsIn(doc: ReportNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: ReportNode) => {
    if (n.type === "evidence" && typeof n.attrs?.entryId === "string") ids.add(n.attrs.entryId);
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
    !(content[j].type === "generated" && REGION_BREAKS.has(content[j].attrs?.kind as GeneratedKind))
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
  if (facts === -1) return content.length;
  const services = content[facts + 1];
  return services?.type === "generated" && services.attrs?.kind === "services" ? facts + 2 : facts + 1;
}

/**
 * Appends entries that now qualify, are not on the page and were not removed, each to the end of its phase
 * (creating the heading if missing), each followed by an empty slot. Never removes or reorders anything.
 */
export function addNewEvidence(
  doc: ReportNode,
  data: ReportData,
  target: ReportTarget,
  _meta: ReportMeta,
  removed: string[],
): { doc: ReportNode; added: string[] } {
  const skip = new Set([...evidenceIdsIn(doc), ...removed]);
  const content = [...(doc.content ?? [])];
  const added: string[] = [];

  for (const hostId of machinesInOrder(data, target)) {
    const kept = keptEntries(data, hostId);
    const split = phaseSplit(kept, data, hostId, hostEntry(data, target, hostId));
    for (const e of kept) {
      if (skip.has(e.id)) continue;
      const phase = split.get(e.id)!;
      let at = content.findIndex((n) => isPhase(n, hostId, phase));
      if (at === -1) {
        at = placeForPhase(content, hostId, phase);
        content.splice(at, 0, phaseNode(phase, hostId));
      }
      content.splice(regionEnd(content, at), 0, ...evidenceNodes(e));
      skip.add(e.id);
      added.push(e.id);
    }
  }
  return { doc: added.length > 0 ? { ...doc, content } : doc, added };
}
