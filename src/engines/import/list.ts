import { engagementKindFor } from "./types";
import type { ImportCandidate, OldBackup, OldMachine } from "./types";

/** Genuinely custom: the operator's own target (old utils/targetType.ts). */
const isCustom = (m: OldMachine) => m.id.startsWith("custom-") || m.platform === "Custom";
const isLab = (m: OldMachine) => isCustom(m) && (m.tags ?? []).some((t) => String(t).toLowerCase() === "pro-lab");

function candidate(m: OldMachine, kind: "lab" | "standalone", hostCount: number): ImportCandidate {
  const ats = (m.logEntries ?? []).map((e) => e.at).filter((n) => Number.isFinite(n));
  const created = Date.parse(m.createdAt);
  return {
    id: m.id,
    name: m.name,
    kind,
    engagementKind: engagementKindFor(m.engagementKind),
    hostCount,
    logCount: (m.logEntries ?? []).length,
    firstAt: ats.length ? Math.min(...ats) : null,
    lastAt: ats.length ? Math.max(...ats) : null,
    createdAt: Number.isNaN(created) ? 0 : created,
  };
}

/** Labs and standalone custom machines. Lab boxes and catalog (HTB/THM) machines are never listed. */
export function listImportable(b: OldBackup): ImportCandidate[] {
  const labIds = new Set(b.machines.filter(isLab).map((m) => m.id));
  const out: ImportCandidate[] = [];
  for (const m of b.machines) {
    if (!isCustom(m)) continue;
    if (labIds.has(m.id)) {
      const boxes = b.machines.filter((x) => x.labId === m.id && x.id !== m.id).length;
      out.push(candidate(m, "lab", boxes));
    } else if (!m.labId || m.labId === m.id || !labIds.has(m.labId)) {
      out.push(candidate(m, "standalone", 1));
    }
  }
  return out;
}
