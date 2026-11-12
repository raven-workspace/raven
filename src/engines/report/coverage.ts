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

const REASON_WORDS: Record<ReasonKind, string> = {
  control: "blocked by a control",
  precondition: "precondition not met",
  access: "no access",
  operator: "operator error",
};

const joinWords = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** A service's coverage on one host (§5.5): exploited, tested, or untested; an override wins. */
export function serviceCoverage(
  data: ReportData,
  hostId: string,
  overrides: Record<string, CoverageOverride>,
): CoverageRow[] {
  const notes = [
    ...data.attempts.filter((a) => !a.private && a.hostId === hostId).map((a) => ({ text: a.title, via: a.title })),
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
      const re = new RegExp(`\\b${s.port}\\b`);
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
      if (override) result = override.result;
      return { serviceId: s.id, port: s.port, protocol: s.protocol, product, proven: confirmed !== null, result, via };
    });
}

export interface ExploitedSystem {
  hostId: string;
  name: string;
  ip: string | null;
  access: "user" | "root" | "none";
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
      if (!host) return [];
      const method =
        sectionMeta[t.key]?.method ?? data.findings.find((f) => f.hostIds.includes(id))?.title ?? "";
      return [{ hostId: id, name: host.name, ip: host.ip, access: host.access, method }];
    }),
  );
}

export interface ChainHop {
  from: string | null;
  to: string;
  via: string;
  entryId: string | null;
}

/** Hops into the AD hosts plus admin/system grants on them, ordered by time. */
export function attackChain(data: ReportData, hostIds: string[]): ChainHop[] {
  const ids = new Set(hostIds);
  const steps: (ChainHop & { at: number })[] = [
    ...data.hops
      .filter((h) => ids.has(h.toHostId))
      .map((h) => ({ from: h.fromHostId, to: h.toHostId, via: h.via, entryId: h.logEntryId, at: h.at })),
    ...data.grants
      .filter((g) => ids.has(g.hostId) && (g.level === "admin" || g.level === "system"))
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
      .filter((a) => !a.private && (a.hostId ?? null) === hostId)
      .map((a) => ({ title: a.title, reason: REASON_WORDS[a.reasonKind] })),
    ...data.ruledOut
      .filter((r) => !r.private && (r.hostId ?? null) === hostId)
      .map((r) => ({ title: r.text, reason: r.reason })),
  ];
}
