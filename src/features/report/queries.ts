import { useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import {
  DRAFT_LAYOUT,
  testedNotExploited,
  type PageMeta,
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
import { useAccessGrants, useCredAttempts, useCredentials, useUsernames } from "../credentials/queries";
import { findingFilesKey, useFailedAttempts, useFindings } from "../findings/queries";
import { useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { useNotes } from "../notes/queries";
import { flushReports, forgetReportSave, patchCachedSection, pruneRemoved, queueReportSave } from "./saveQueue";

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
  const credAttempts = useCredAttempts(eid);
  const files = useQueries({
    queries: (findings.data ?? []).map((f) => ({ queryKey: findingFilesKey(f.id), queryFn: () => api.findingFilesList(f.id) })),
    combine: combineFiles,
  });
  const findingFiles = files.data;

  const queries = [engagement, hosts, services, log, checklist, findings, attempts, ruledOut, grants, usernames, hops, cleanup, notes, credentials, credAttempts];
  const isLoading = files.isPending || queries.some((q) => q.isPending);
  const error = queries.find((q) => q.error)?.error ?? files.error;

  const data = useMemo((): ReportData | undefined => {
    if (
      !engagement.data || !hosts.data || !services.data || !log.data || !checklist.data || !findings.data || !findingFiles ||
      !attempts.data || !ruledOut.data || !grants.data || !usernames.data || !hops.data || !cleanup.data || !notes.data || !credentials.data ||
      !credAttempts.data
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
      credAttempts: credAttempts.data,
    };
  }, [
    engagement.data, hosts.data, services.data, log.data, checklist.data, findings.data, findingFiles, attempts.data,
    ruledOut.data, grants.data, usernames.data, hops.data, cleanup.data, notes.data, credentials.data, credAttempts.data,
  ]);
  const refetch = () => {
    queries.filter((q) => q.error).forEach((q) => void q.refetch());
    files.refetch();
  };
  return { data, isLoading: isLoading && !data, error, refetch };
}

/** The front matter, in §5.7 order (OffSec's sample), before the targets. */
export const FRONT_KINDS: SectionKind[] = ["details", "introduction", "summary", "considerations", "methodology"];
/** After the targets and the appendix pages: the closing sections. There are no generated appendices. */
export const BACK_KINDS: SectionKind[] = ["further", "references"];

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

/** The title a new page starts with, per placement. */
export const pageTitle = (placement: PageMeta["placement"]) => (placement === "appendix" ? "Untitled appendix" : "Untitled page");

/**
 * + Page (§10.4): an owner-written page, kind `page`, keyed by a fresh id (keeps the unique index), with one empty
 * paragraph. Stored under the current draft layout, so it is never rebuilt.
 */
export function createPage(report: Report, placement: PageMeta["placement"], position: number): Promise<ReportSection> {
  const meta: PageMeta & { layout: number } = { title: pageTitle(placement), placement, layout: DRAFT_LAYOUT };
  return api.reportSectionUpsert(report.id, {
    kind: "page",
    targetKey: crypto.randomUUID(),
    position,
    doc: { type: "doc", content: [{ type: "paragraph" }] },
    meta: meta as unknown as Record<string, unknown>,
    draftBuiltAt: Date.now(),
  });
}

/**
 * Renames a page that is not open: its cached page with the new title goes through the save queue (the queue patches
 * the cache before every write, so the cached page is the latest one). The open page renames through its own editor's
 * meta instead, so a keystroke's save never carries the old title.
 */
export function renamePage(qc: QueryClient, section: ReportSection, title: string) {
  const cached = qc.getQueryData<ReportSection[]>(reportSectionsKey(section.reportId))?.find((s) => s.id === section.id) ?? section;
  const meta = { ...cached.meta, title } as SectionMeta;
  patchCachedSection(qc, section.id, { meta: meta as Record<string, unknown> });
  queueReportSave(qc, section.id, (cached.doc ?? { type: "doc", content: [] }) as ReportNode, meta);
}

/**
 * Deletes a page: queued typing is written first, so the section kept for Undo holds every word; once deleted, any
 * write the flush couldn't land is forgotten, so none is retried against the deleted id. Returns that kept section; `restorePage` brings it back for the session.
 */
export async function deletePage(qc: QueryClient, section: ReportSection): Promise<ReportSection> {
  await flushReports();
  const key = reportSectionsKey(section.reportId);
  const kept = qc.getQueryData<ReportSection[]>(key)?.find((s) => s.id === section.id) ?? section;
  await api.reportSectionDelete(section.reportId, section.id);
  // A write the flush couldn't land (failed, refused) would otherwise be retried against the deleted id forever.
  forgetReportSave(section.id);
  qc.setQueryData<ReportSection[]>(key, (list = []) => list.filter((s) => s.id !== section.id));
  return kept;
}

/** Undo of `deletePage`: the kept page comes back under its key, title, place and text. */
export async function restorePage(qc: QueryClient, kept: ReportSection): Promise<ReportSection> {
  const back = await api.reportSectionUpsert(kept.reportId, {
    kind: "page",
    targetKey: kept.targetKey,
    position: kept.position,
    doc: kept.doc,
    meta: kept.meta,
    draftBuiltAt: kept.draftBuiltAt,
  });
  qc.setQueryData<ReportSection[]>(reportSectionsKey(kept.reportId), (list = []) => [...list.filter((s) => s.id !== back.id), back]);
  return back;
}

/** A stored page built with the current draft layout (6: a plain document); any other (older, or none yet) is rebuilt
 *  as the plain draft when it opens, the stored page kept in `previousDoc`. An owner-written page (+ Page) is never
 *  built, so it is always current: one holding old nodes is flattened when it opens instead. */
export const hasCurrentPage = (s: ReportSection) =>
  s.doc != null && (s.kind === "page" || (s.meta as SectionMeta).layout === DRAFT_LAYOUT);

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
