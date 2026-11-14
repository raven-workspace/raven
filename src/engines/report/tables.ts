import type { AccessGrant } from "../../types/credentials";
import type { Severity } from "../../types/findings";
import type { FlagKind } from "../../types/log";
import { byTime, hostEntry, machinesInOrder, severityRank, findingPhaseMap } from "./draft";
import { expectedFlags } from "./meta";
import type { ReportData, ReportMeta, ReportTarget } from "./types";

const hostName = (data: ReportData, id: string) => data.hosts.find((h) => h.id === id)?.name ?? id;
const userName = (data: ReportData, usernameId: string) => data.usernames.find((u) => u.id === usernameId)?.username ?? "?";
const LEVEL_RANK = { user: 0, admin: 1, system: 2 } as const;
const byGrantTime = (a: AccessGrant, b: AccessGrant) => a.at - b.at || a.id.localeCompare(b.id);

export interface PortRow {
  serviceId: string;
  port: string;
  service: string;
  version: string;
}

/** A host's open services in port order, as the port table prints them (confirmed product and version, else nmap's). */
export function portRows(data: ReportData, hostId: string): PortRow[] {
  return data.services
    .filter((s) => s.hostId === hostId && s.state.startsWith("open"))
    .sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol))
    .map((s) => ({
      serviceId: s.id,
      port: `${s.port}/${s.protocol}`,
      service: s.confirmedProduct ?? s.nmapService ?? "",
      version: s.confirmedVersion ?? s.nmapVersion ?? "",
    }));
}

export interface ResultLine {
  access: string;
  flags: { kind: FlagKind; value: string }[];
}

const isLinux = (data: ReportData, hostId: string) => data.hosts.find((h) => h.id === hostId)?.os === "linux";

/** The word for an elevated access level on a host: Root on Linux, else SYSTEM or Administrator; null for a plain user. */
function levelWord(data: ReportData, hostId: string, level: AccessGrant["level"]): "Root" | "SYSTEM" | "Administrator" | null {
  if (level === "user") return null;
  if (isLinux(data, hostId)) return "Root";
  return level === "system" ? "SYSTEM" : "Administrator";
}
/** The result line's wording of that level. */
const lineWord = (w: "Root" | "SYSTEM" | "Administrator") => (w === "Root" ? "root" : w === "SYSTEM" ? w : "local administrator");

/** What a machine's result line says: how access was gained and raised (grants in time order), then its flags. */
export function resultLine(data: ReportData, target: ReportTarget, hostId: string, meta: ReportMeta): ResultLine {
  const grants = data.grants.filter((g) => g.hostId === hostId).sort(byGrantTime);
  const parts: string[] = [];
  if (grants.length > 0) {
    const first = grants[0];
    const hop =
      hostEntry(data, target, hostId) === "hop"
        ? data.hops.filter((h) => h.toHostId === hostId && h.fromHostId != null).sort((a, b) => a.at - b.at)[0]
        : undefined;
    const firstWord = levelWord(data, hostId, first.level);
    // A machine entered already elevated names its level: "shell as `x` (root)", "WinRM as `x` (local administrator)".
    parts.push(`${hop ? hop.via : "shell"} as \`${userName(data, first.usernameId)}\`${firstWord ? ` (${lineWord(firstWord)})` : ""}`);
    // Each later grant adds its level once: a level the line already ends on (the first grant's own included) is not
    // repeated, whoever it was granted to.
    let last = firstWord;
    for (const g of grants.slice(1)) {
      const w = levelWord(data, hostId, g.level);
      if (!w || w === last) continue;
      last = w;
      parts.push(w === "Administrator" ? `${lineWord(w)} as \`${userName(data, g.usernameId)}\`` : lineWord(w));
    }
  }
  const entries = data.log.filter((e) => e.kind === "flag" && !e.private && e.hostIds.includes(hostId)).sort(byTime);
  const flags: ResultLine["flags"] = [];
  const expected = expectedFlags(target, hostId, meta);
  for (const kind of ["local", "proof"] as FlagKind[]) {
    if (!expected.includes(kind)) continue;
    // A flag entry with no value yet prints nothing ("local.txt ." otherwise).
    const e = entries.find((x) => x.content.kind === "flag" && x.content.flagKind === kind && x.content.value.trim() !== "");
    if (e && e.content.kind === "flag") flags.push({ kind, value: e.content.value.trim() });
  }
  return { access: parts.join(", then "), flags };
}

export interface FindingRow {
  n: number;
  findingId: string;
  host: string;
  title: string;
  severity: Severity | null;
  result: string;
}

/** What a finding gave, from the phase the draft placed it in (§10.3). */
function resultOf(data: ReportData, target: ReportTarget, hostId: string, phase: string): string {
  const hopEntered = hostEntry(data, target, hostId) === "hop";
  switch (phase) {
    case "foothold":
      return hopEntered ? "Foothold" : "Initial access";
    case "lateral":
      return "Foothold";
    case "domain":
      return "Domain Admin";
    case "privesc": {
      const top = data.grants.filter((g) => g.hostId === hostId).reduce((m, g) => Math.max(m, LEVEL_RANK[g.level]), -1);
      if (top < LEVEL_RANK.admin) return "Privilege escalation";
      return levelWord(data, hostId, top === LEVEL_RANK.system ? "system" : "admin") ?? "None";
    }
    default:
      return "None";
  }
}

/** Every finding on a report target's machines, once, most severe first, then in the targets' grading order. */
export function findingRows(data: ReportData, targets: ReportTarget[]): FindingRow[] {
  const seen = new Set<string>();
  const rows: (Omit<FindingRow, "n"> & { rank: number; targetIndex: number; created: number })[] = [];
  targets.forEach((target, targetIndex) => {
    const machines = machinesInOrder(data, target);
    for (const [findingId, { hostId, phase }] of findingPhaseMap(data, target)) {
      const f = data.findings.find((x) => x.id === findingId);
      if (!f || seen.has(findingId)) continue;
      seen.add(findingId);
      const names = machines.filter((id) => f.hostIds.includes(id) || id === hostId).map((id) => hostName(data, id));
      rows.push({
        findingId,
        host: names.join(" / "),
        title: f.title,
        severity: f.severity,
        result: resultOf(data, target, hostId, phase),
        rank: severityRank(f),
        targetIndex,
        created: f.createdAt,
      });
    }
  });
  rows.sort((a, b) => a.rank - b.rank || a.targetIndex - b.targetIndex || a.created - b.created || a.title.localeCompare(b.title));
  return rows.map((r, i) => ({ n: i + 1, findingId: r.findingId, host: r.host, title: r.title, severity: r.severity, result: r.result }));
}

export interface ScopeRow {
  host: string;
  ip: string;
  os: string;
  set: "Independent" | "AD";
}

const OS_NAMES = { windows: "Windows", linux: "Linux", other: "" } as const;

/** One row per report target machine in grading order (an AD set's machines in attack-path order). */
export function scopeRows(data: ReportData, targets: ReportTarget[]): ScopeRow[] {
  return targets.flatMap((target) =>
    machinesInOrder(data, target).flatMap((id) => {
      const h = data.hosts.find((x) => x.id === id);
      if (!h) return [];
      return [{ host: h.name, ip: h.ip ?? "", os: h.os ? OS_NAMES[h.os] : "", set: target.kind === "ad-set" ? ("AD" as const) : ("Independent" as const) }];
    }),
  );
}

export interface AttackPathRow {
  step: number;
  from: string;
  technique: string;
  to: string;
  access: string;
}

/** The AD set's hops and access grants in time order. A grant logged with a hop's own entry is that hop's access. */
export function attackPathRows(data: ReportData, hostIds: string[]): AttackPathRow[] {
  const ids = new Set(hostIds);
  const hops = data.hops.filter((h) => ids.has(h.toHostId));
  const grants = data.grants.filter((g) => ids.has(g.hostId));
  const accessOf = (g: AccessGrant) => `\`${userName(data, g.usernameId)}\` (${g.level})`;
  const taken = new Set<string>();
  type Row = { at: number; from: string; technique: string; to: string; access: string };
  const rows: Row[] = [];
  for (const h of hops) {
    const g = h.logEntryId ? grants.find((x) => x.logEntryId === h.logEntryId && x.hostId === h.toHostId) : undefined;
    if (g) taken.add(g.id);
    rows.push({
      at: h.at,
      from: h.fromHostId ? hostName(data, h.fromHostId) : "Kali",
      technique: h.via,
      to: hostName(data, h.toHostId),
      access: g ? accessOf(g) : "",
    });
  }
  for (const g of grants) {
    if (taken.has(g.id)) continue;
    const name = hostName(data, g.hostId);
    rows.push({ at: g.at, from: name, technique: g.via, to: name, access: accessOf(g) });
  }
  // Stable sort keeps hops before grants logged at the same moment.
  rows.sort((a, b) => a.at - b.at);
  return rows.map((r, i) => ({ step: i + 1, from: r.from, technique: r.technique, to: r.to, access: r.access }));
}
