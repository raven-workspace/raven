import { engagementKindFor } from "./types";
import type { ImportCandidate, OldBackup, OldMachine } from "./types";

/** Genuinely custom: the operator's own target (old utils/targetType.ts). */
const isCustom = (m: OldMachine) => m.id.startsWith("custom-") || m.platform === "Custom";
const tagsOf = (m: OldMachine): unknown[] => (Array.isArray(m.tags) ? m.tags : []);
const isLab = (m: OldMachine) => isCustom(m) && tagsOf(m).some((t) => String(t).toLowerCase() === "pro-lab");

function candidate(m: OldMachine, kind: "lab" | "standalone", hostCount: number): ImportCandidate {
  let count = 0;
  let first: number | null = null;
  let last: number | null = null;
  if (Array.isArray(m.logEntries)) {
    for (const e of m.logEntries as unknown[]) {
      if (typeof e !== "object" || e === null) continue;
      count++;
      const at = (e as { at?: unknown }).at;
      if (typeof at !== "number" || !Number.isFinite(at)) continue;
      if (first === null || at < first) first = at;
      if (last === null || at > last) last = at;
    }
  }
  const created = Date.parse(m.createdAt);
  return {
    id: m.id,
    name: typeof m.name === "string" ? m.name : m.id,
    kind,
    engagementKind: engagementKindFor(m.engagementKind),
    hostCount,
    logCount: count,
    firstAt: first,
    lastAt: last,
    createdAt: Number.isNaN(created) ? 0 : created,
  };
}

/** Labs and standalone custom machines. Lab boxes and catalog (HTB/THM) machines are never listed. */
export function listImportable(b: OldBackup): ImportCandidate[] {
  const machines = (Array.isArray(b.machines) ? b.machines : []).filter(
    (m): m is OldMachine => typeof m === "object" && m !== null && typeof m.id === "string",
  );
  const labIds = new Set(machines.filter(isLab).map((m) => m.id));
  const seen = new Set<string>();
  const out: ImportCandidate[] = [];
  for (const m of machines) {
    if (!isCustom(m) || seen.has(m.id)) continue;
    seen.add(m.id);
    if (labIds.has(m.id)) {
      const boxes = machines.filter((x) => x.labId === m.id && x.id !== m.id).length;
      out.push(candidate(m, "lab", boxes));
    } else if (!m.labId || m.labId === m.id || !labIds.has(m.labId)) {
      out.push(candidate(m, "standalone", 1));
    }
  }
  return out;
}
