import { useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  evidenceIdsIn,
  testedNotExploited,
  type ReportData,
  type ReportNode,
  type ReportTarget,
  type SectionMeta,
} from "../../engines/report";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import type { FindingFile } from "../../types/findings";
import type { Report, ReportDoc, ReportSection, SectionInput, SectionKind } from "../../types/report";
import { useChecklist, useEngagementServices, useHops } from "../checklist/queries";
import { useCleanup } from "../cleanup/queries";
import { useAccessGrants, useCredentials, useUsernames } from "../credentials/queries";
import { findingFilesKey, useFailedAttempts, useFindings } from "../findings/queries";
import { useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { useNotes } from "../notes/queries";

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

/** Writes a section into every cached sections list that holds it. */
export function patchCachedSection(qc: QueryClient, id: string, patch: Partial<ReportSection>) {
  qc.setQueriesData<ReportSection[]>({ queryKey: ["reportSections"] }, (list) =>
    list?.some((s) => s.id === id) ? list.map((s) => (s.id === id ? { ...s, ...patch } : s)) : list,
  );
}

/** Drops removed-entry ids whose entry is on the page again (an undo), so the meta only lists entries really removed. */
export function pruneRemoved(doc: ReportNode, meta: SectionMeta): SectionMeta {
  if (!meta.removedEntryIds?.length) return meta;
  const onPage = evidenceIdsIn(doc);
  const kept = meta.removedEntryIds.filter((id) => !onPage.has(id));
  return kept.length === meta.removedEntryIds.length ? meta : { ...meta, removedEntryIds: kept };
}

const SAVE_DEBOUNCE_MS = 600;

/**
 * Autosave for the open section: `save` queues the latest page and meta and writes them 600 ms after the last change.
 * The queue is flushed when the section changes and on unmount, so a switch or leaving never drops typing.
 *
 * Unsaved writes are kept per section: a failed write stays queued (a later save of another section never replaces
 * it) and is retried on every flush, so on the next change anywhere. `onError` fires while any write is unsaved,
 * `onSaved` only once every section is written.
 */
export function useSectionSaver(
  sectionId: string,
  opts: { onError?(error: unknown): void; onSaved?(): void } = {},
): { save(doc: ReportNode, meta: SectionMeta): void; flush(): Promise<void> } {
  const qc = useQueryClient();
  const callbacks = useRef(opts);
  useEffect(() => {
    callbacks.current = opts;
  });
  type Write = { doc: ReportNode; meta: SectionMeta };
  const unsaved = useRef(new Map<string, Write>());
  // Writes on their way: a flush doesn't send the same write twice.
  const inFlight = useRef(new Set<Write>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const writes = [...unsaved.current].filter(([, w]) => !inFlight.current.has(w));
    if (writes.length === 0) return;
    let failure: unknown = null;
    await Promise.all(
      writes.map(async ([id, w]) => {
        const meta = pruneRemoved(w.doc, w.meta);
        patchCachedSection(qc, id, { doc: w.doc as ReportDoc, meta: meta as Record<string, unknown> });
        inFlight.current.add(w);
        try {
          await api.reportSectionSave(id, w.doc as ReportDoc, meta as Record<string, unknown>);
          // A newer change queued meanwhile stays for its own write.
          if (unsaved.current.get(id) === w) unsaved.current.delete(id);
        } catch (e) {
          failure = e;
          reportError(e);
        } finally {
          inFlight.current.delete(w);
        }
      }),
    );
    if (failure !== null) callbacks.current.onError?.(failure);
    else if (unsaved.current.size === 0) callbacks.current.onSaved?.();
  }, [qc]);

  const save = useCallback(
    (doc: ReportNode, meta: SectionMeta) => {
      unsaved.current.set(sectionId, { doc, meta });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [sectionId, flush],
  );

  // Section change and unmount: write what is queued for the section being left (and retry anything unsaved).
  useEffect(() => () => void flush(), [sectionId, flush]);
  return useMemo(() => ({ save, flush }), [save, flush]);
}
