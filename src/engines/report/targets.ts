import { BOARD_COLUMNS, type Host } from "../../types/host";
import type { ReportData, ReportMeta, ReportTarget } from "./types";


const byName = (a: Host, b: Host) => a.name.localeCompare(b.name);
const byBoardThenName = (a: Host, b: Host) =>
  BOARD_COLUMNS.indexOf(a.boardColumn) - BOARD_COLUMNS.indexOf(b.boardColumn) || byName(a, b);

/** The targets a report has sections for: standalone hosts, then one AD set. */
export function reportTargets(data: ReportData, meta: ReportMeta): ReportTarget[] {
  const kind = data.engagement.kind;
  if (kind === "client") return [];

  let chosen: Host[];
  if (kind === "exam-sim") {
    chosen = data.hosts;
  } else if (meta.includedHostIds) {
    const ids = new Set(meta.includedHostIds);
    chosen = data.hosts.filter((h) => ids.has(h.id));
  } else {
    const flagged = new Set<string>();
    for (const e of data.log) {
      if (e.kind === "flag" && !e.private) for (const id of e.hostIds) flagged.add(id);
    }
    chosen = data.hosts.filter((h) => flagged.has(h.id));
  }

  const targets: ReportTarget[] = chosen
    .filter((h) => !h.adSetEffective)
    .sort(byBoardThenName)
    .map((h) => ({ key: h.id, kind: "standalone", hostIds: [h.id] }));
  const ad = chosen.filter((h) => h.adSetEffective).sort(byName);
  if (ad.length > 0) targets.push({ key: "ad-set", kind: "ad-set", hostIds: ad.map((h) => h.id) });
  return targets;
}
