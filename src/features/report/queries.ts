import { useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import {
  testedNotExploited,
  type ReportData,
  type ReportNode,
  type ReportTarget,
  type SectionMeta,
} from "../../engines/report";
import { api } from "../../lib/api";
import type { FindingFile } from "../../types/findings";
import type { Report, ReportSection, SectionInput, SectionKind } from "../../types/report";
import { useChecklist, useEngagementServices, useHops } from "../checklist/queries";
import { useCleanup } from "../cleanup/queries";
import { useAccessGrants, useCredentials, useUsernames } from "../credentials/queries";
import { findingFilesKey, useFailedAttempts, useFindings } from "../findings/queries";
import { useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { useNotes } from "../notes/queries";
import { flushReports, patchCachedSection, pruneRemoved, queueReportSave } from "./saveQueue";

export const reportKey = (eid: string) => ["report", eid] as const;
export const reportSectionsKey = (reportId: string) => ["reportSections", reportId] as const;

/** The engagement's report, created on first open. */
export function useReport(eid: string, enabled = true) {
  return useQuery({ queryKey: reportKey(eid), queryFn: () => api.reportGetOrCreate(eid), enabled });
}

export function useReportSections(reportId: string | undefined) {
  return useQuery({
    queryKey: reportSectionsKey(reportId ?? ""),
    queryFn: () => api.reportSectionsList(reportId!),
    enabled: !!reportId,
  });
}

/** Every finding's files as one list, once all have loaded. Module-level, so TanStack keeps the result stable between renders. */
function combineFiles(results: UseQueryResult<FindingFile[]>[]) {
  return {
    data: results.every((r) => r.data) ? results.flatMap((r) => r.data!) : undefined,
    isPending: results.some((r) => r.isPending),
    error: results.find((r) => r.error)?.error ?? null,
    refetch: () => results.filter((r) => r.error).forEach((r) => void r.refetch()),
  };
}

/** Everything the report engine reads for one engagement, from the queries the rest of the app already keeps fresh. */
export function useReportData(eid: string): { data: ReportData | undefined; isLoading: boolean; error: Error | null; refetch(): void } {
  const engagement = useQuery({ queryKey: ["engagement", eid], queryFn: () => api.engagementGet(eid) });
  const hosts = useHosts(eid);
  const services = useEngagementServices(eid).query;
  const log = useLog(eid);
  const checklist = useChecklist(eid).query;
  const findings = useFindings(eid);
  const attempts = useFailedAttempts(eid);
  const ruledOut = useQuery({ queryKey: ["ruledOut", eid], queryFn: () => api.ruledOutList(eid) });
  const grants = useAccessGrants(eid);
  const usernames = useUsernames(eid);
  const hops = useHops(eid).query;
  const cleanup = useCleanup(eid);
  const notes = useNotes(eid);
  const credentials = useCredentials(eid);
  const files = useQueries({
    queries: (findings.data ?? []).map((f) => ({ queryKey: findingFilesKey(f.id), queryFn: () => api.findingFilesList(f.id) })),
    combine: combineFiles,
  });
  const findingFiles = files.data;

  const queries = [engagement, hosts, services, log, checklist, findings, attempts, ruledOut, grants, usernames, hops, cleanup, notes, credentials];
  const isLoading = files.isPending || queries.some((q) => q.isPending);
  const error = queries.find((q) => q.error)?.error ?? files.error;

  const data = useMemo((): ReportData | undefined => {
    if (
      !engagement.data || !hosts.data || !services.data || !log.data || !checklist.data || !findings.data || !findingFiles ||
      !attempts.data || !ruledOut.data || !grants.data || !usernames.data || !hops.data || !cleanup.data || !notes.data || !credentials.data
    ) {
      return undefined;
    }
    return {
      engagement: engagement.data,
      hosts: hosts.data,
      services: services.data,
      log: log.data,
      checklist: checklist.data,
      findings: findings.data,
      findingFiles,
      attempts: attempts.data,
      ruledOut: ruledOut.data,
      grants: grants.data,
      usernames: usernames.data,
      hops: hops.data,
      cleanup: cleanup.data,
      notes: notes.data,
      credentials: credentials.data,
    };
  }, [
    engagement.data, hosts.data, services.data, log.data, checklist.data, findings.data, findingFiles, attempts.data,
    ruledOut.data, grants.data, usernames.data, hops.data, cleanup.data, notes.data, credentials.data,
  ]);
  const refetch = () => {
    queries.filter((q) => q.error).forEach((q) => void q.refetch());
    files.refetch();
  };
  return { data, isLoading: isLoading && !data, error, refetch };
}

/** The front matter, in §5.7 order, before the targets. */
export const FRONT_KINDS: SectionKind[] = ["details", "summary", "considerations", "methodology"];
/** After the targets: appendices, then the closing sections. */
export const BACK_KINDS: SectionKind[] = ["appendix-proof", "appendix-tools", "appendix-msf", "appendix-cleanup", "further", "references"];

/** A section's identity: its kind and target key. */
export const sectionKey = (kind: SectionKind, targetKey: string | null) => `${kind}:${targetKey ?? ""}`;

/** Whether the engagement has tested-not-exploited items not tied to a host. */
export const hasEngagementTested = (data: ReportData) => testedNotExploited(data, null).length > 0;

/** Every section the report should have, in §5.7 order: front matter, targets in `reportTargets` order, back matter. */
export function wantedSections(targets: ReportTarget[], data: ReportData): { kind: SectionKind; targetKey: string | null }[] {
  return [
    ...FRONT_KINDS.map((kind) => ({ kind, targetKey: null })),
    ...targets.map((t) => (t.kind === "ad-set" ? { kind: "ad" as const, targetKey: "ad-set" } : { kind: "target" as const, targetKey: t.key })),
    ...(hasEngagementTested(data) ? [{ kind: "engagement-tested" as const, targetKey: null }] : []),
    ...BACK_KINDS.map((kind) => ({ kind, targetKey: null })),
  ];
}

/**
 * Upserts the sections the report lacks, with `doc: null`; existing sections are never touched (an upsert would
 * overwrite their page). On a first open they take positions in §5.7 order; a later one (a new host) goes after every
 * existing section, so it lands last among the targets. Returns the sections created.
 */
export async function ensureSections(
  report: Report,
  targets: ReportTarget[],
  data: ReportData,
  existing: ReportSection[],
): Promise<ReportSection[]> {
  const have = new Set(existing.map((s) => sectionKey(s.kind, s.targetKey)));
  const missing = wantedSections(targets, data).filter((w) => !have.has(sectionKey(w.kind, w.targetKey)));
  let next = existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.position)) + 1;
  const created: ReportSection[] = [];
  for (const w of missing) {
    const input: SectionInput = { kind: w.kind, targetKey: w.targetKey, position: next++, doc: null, meta: {}, draftBuiltAt: null };
    created.push(await api.reportSectionUpsert(report.id, input));
  }
  return created;
}

export { patchCachedSection, pruneRemoved };

/**
 * Autosave for the open section, through the report save queue (`saveQueue.ts`): `save` queues the latest page and
 * meta, written 600 ms after the last change. The queue is flushed when the section changes and on unmount, so a
 * switch or leaving never waits on the debounce; a failed write stays queued and is retried outside the view.
 */
export function useSectionSaver(sectionId: string): { save(doc: ReportNode, meta: SectionMeta): void; flush(): Promise<void> } {
  const qc = useQueryClient();
  const save = useCallback((doc: ReportNode, meta: SectionMeta) => queueReportSave(qc, sectionId, doc, meta), [qc, sectionId]);
  // Section change and unmount: write what is queued now.
  useEffect(() => () => void flushReports(), [sectionId]);
  return useMemo(() => ({ save, flush: flushReports }), [save]);
}
