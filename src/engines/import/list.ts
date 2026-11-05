import { gatherLogs } from "./logs";
import { engagementKindFor } from "./types";
import type { ImportCandidate, OldBackup, OldMachine } from "./types";

/** Genuinely custom: the operator's own target (old utils/targetType.ts). */
export const isCustom = (m: OldMachine) => m.id.startsWith("custom-") || m.platform === "Custom";
const tagsOf = (m: OldMachine): unknown[] => (Array.isArray(m.tags) ? m.tags : []);
export const isLab = (m: OldMachine) => isCustom(m) && tagsOf(m).some((t) => String(t).toLowerCase() === "pro-lab");

/** The backup's machine rows that have a string id; the first row with an id wins. */
export function machinesOf(b: OldBackup): OldMachine[] {
  const seen = new Set<string>();
  const out: OldMachine[] = [];
  for (const m of Array.isArray(b?.machines) ? (b.machines as unknown[]) : []) {
    if (typeof m !== "object" || m === null || typeof (m as OldMachine).id !== "string") continue;
    const row = m as OldMachine;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** Boxes of a lab (old getLabBoxes). */
export const boxesOf = (machines: OldMachine[], labId: string) => machines.filter((x) => x.labId === labId && x.id !== labId);

function candidate(m: OldMachine, kind: "lab" | "standalone", boxes: OldMachine[]): ImportCandidate {
  const { entries } = gatherLogs(m, boxes);
  let first: number | null = null;
  let last: number | null = null;
  for (const e of entries) {
    const at = e.at;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (first === null || at < first) first = at;
    if (last === null || at > last) last = at;
  }
  const created = Date.parse(m.createdAt);
  return {
    id: m.id,
    name: typeof m.name === "string" ? m.name : m.id,
    kind,
    engagementKind: engagementKindFor(m.engagementKind),
    hostCount: kind === "lab" ? boxes.length : 1,
    logCount: entries.length,
    firstAt: first,
    lastAt: last,
    createdAt: Number.isNaN(created) ? 0 : created,
  };
}

/** Labs and standalone custom machines. Lab boxes and catalog (HTB/THM) machines are never listed. */
export function listImportable(b: OldBackup): ImportCandidate[] {
  const machines = machinesOf(b);
  const labIds = new Set(machines.filter(isLab).map((m) => m.id));
  const out: ImportCandidate[] = [];
  for (const m of machines) {
    if (!isCustom(m)) continue;
    if (labIds.has(m.id)) {
      out.push(candidate(m, "lab", boxesOf(machines, m.id)));
    } else if (!m.labId || m.labId === m.id || !labIds.has(m.labId)) {
      out.push(candidate(m, "standalone", []));
    }
  }
  return out;
}
