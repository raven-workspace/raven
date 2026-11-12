import type { ReasonKind } from "../../types/findings";
import type { ReportData, ReportTarget, SectionMeta, CoverageOverride, CoverageResult } from "./types";

export interface CoverageRow {
  serviceId: string;
  port: number;
  protocol: string;
  product: string;
  /** False when the product is only nmap's guess. */
  proven: boolean;
  result: CoverageResult;
  via: string | null;
}

const REASON_WORDS: Record<Exclude<ReasonKind, "operator">, string> = {
  control: "blocked by a control",
  precondition: "precondition not met",
  access: "no access",
};

const joinWords = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** A service's coverage on one host (§5.5): exploited, tested, or untested; an override wins. */
export function serviceCoverage(
  data: ReportData,
  hostId: string,
  overrides: Record<string, CoverageOverride>,
): CoverageRow[] {
  const notes = [
    ...data.attempts.filter((a) => !a.private && a.reasonKind !== "operator" && a.hostId === hostId).map((a) => ({ text: a.title, via: a.title })),
    ...data.ruledOut
      .filter((r) => !r.private && r.hostId === hostId)
      .map((r) => ({ text: r.text, via: r.text })),
  ];
  return data.services
    .filter((s) => s.hostId === hostId)
    .sort((a, b) => a.port - b.port)
    .map((s): CoverageRow => {
      const confirmed = s.confirmedProduct ? joinWords(s.confirmedProduct, s.confirmedVersion) : null;
      const product = confirmed ?? joinWords(s.nmapService, s.nmapVersion);
      let result: CoverageResult = "untested";
      let via: string | null = null;
      const finding = data.findings.find((f) => f.serviceIds.includes(s.id));
      const re = new RegExp(`(?<![\\d.])${s.port}(?![\\d.])`);
      const hit = notes.find((n) => re.test(n.text));
      if (finding) {
        result = "exploited";
        via = finding.title;
      } else if (s.verdict === "dead_end") {
        result = "tested";
        via = "ruled out as a dead end";
      } else if (hit) {
        result = "tested";
        via = hit.via;
      }
      const override = overrides[s.id];
      if (override) {
        result = override.result;
        via = override.note ?? null;
      }
      return { serviceId: s.id, port: s.port, protocol: s.protocol, product, proven: confirmed !== null, result, via };
    });
}

export interface ExploitedSystem {
  hostId: string;
  name: string;
  ip: string | null;
  /** The access reached, as the report words it: "user", "SYSTEM" on Windows, else "root". */
  access: "user" | "SYSTEM" | "root";
  method: string;
}

/** The hosts of the given targets with how each was exploited. */
export function exploitedSystems(
  data: ReportData,
  targets: ReportTarget[],
  sectionMeta: Record<string, SectionMeta>,
): ExploitedSystem[] {
  return targets.flatMap((t) =>
    t.hostIds.flatMap((id) => {
      const host = data.hosts.find((h) => h.id === id);
      // Exploited systems only: a host with no access gained is not one.
      if (!host || host.access === "none") return [];
      const method =
        sectionMeta[t.key]?.method ?? data.findings.find((f) => f.hostIds.includes(id))?.title ?? "";
      const access = host.access === "user" ? "user" : host.os === "windows" ? "SYSTEM" : "root";
      return [{ hostId: id, name: host.name, ip: host.ip, access, method }];
    }),
  );
}

export interface ChainHop {
  from: string | null;
  to: string;
  via: string;
  entryId: string | null;
}

/** Hops into the AD hosts plus admin/system grants on them, ordered by time. A grant made by the step that also made
 *  a hop into that host is that hop, so it is listed once. */
export function attackChain(data: ReportData, hostIds: string[]): ChainHop[] {
  const ids = new Set(hostIds);
  const hops = data.hops.filter((h) => ids.has(h.toHostId));
  const isHop = (hostId: string, entryId: string | null) => entryId != null && hops.some((h) => h.toHostId === hostId && h.logEntryId === entryId);
  const steps: (ChainHop & { at: number })[] = [
    ...hops.map((h) => ({ from: h.fromHostId, to: h.toHostId, via: h.via, entryId: h.logEntryId, at: h.at })),
    ...data.grants
      .filter((g) => ids.has(g.hostId) && (g.level === "admin" || g.level === "system") && !isHop(g.hostId, g.logEntryId))
      .map((g) => ({ from: null, to: g.hostId, via: g.via, entryId: g.logEntryId, at: g.at })),
  ];
  return steps
    .sort((a, b) => a.at - b.at)
    .map(({ from, to, via, entryId }) => ({ from, to, via, entryId }));
}

/** Non-private attempts and ruled-out items on a host (null = engagement level), with why they went nowhere. */
export function testedNotExploited(data: ReportData, hostId: string | null): { title: string; reason: string }[] {
  return [
    ...data.attempts
      .filter((a) => !a.private && a.reasonKind !== "operator" && (a.hostId ?? null) === hostId)
      .map((a) => ({ title: a.title, reason: a.reasonKind === "operator" ? "" : [REASON_WORDS[a.reasonKind], a.reason.trim()].filter(Boolean).join(": ") })),
    ...data.ruledOut
      .filter((r) => !r.private && (r.hostId ?? null) === hostId)
      .map((r) => ({ title: r.text, reason: r.reason })),
  ];
}
