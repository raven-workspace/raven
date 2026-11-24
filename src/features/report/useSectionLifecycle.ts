import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  archivePage,
  DRAFT_LAYOUT,
  needsFlatten,
  ownerMeta,
  withoutRemoved,
  type ReportData,
  type ReportNode,
  type ReportTarget,
  type SectionMeta,
} from "../../engines/report";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import type { Report, ReportSection } from "../../types/report";
import { RavenError } from "../../types/errors";
import { reportSchema } from "./editor/extension";
import { ensureSections, hasCurrentPage, patchCachedSection, reportSectionsKey, sectionKey, wantedSections } from "./queries";
import { flushReports, forgetReportSave, isReportSaveQueued, queueReportSave, settleReportSave } from "./saveQueue";

// The report page's lifecycle effects, each with the state only its notices read: creating missing sections,
// flattening an old page as it opens, and building (or rebuilding) a page's plain draft.

/** Creates the report's missing sections. `ensureFailed` is the last failure's message; `retryEnsure` tries again. */
export function useEnsureSections(report: Report, targets: ReportTarget[], data: ReportData, sections: ReportSection[]) {
  const qc = useQueryClient();
  const [ensureFailed, setEnsureFailed] = useState<string | null>(null);

  // Missing sections (first open, a new host) are created once; one run at a time, so nothing is upserted twice.
  const ensuring = useRef(false);
  useEffect(() => {
    if (ensuring.current || ensureFailed) return;
    const have = new Set(sections.map((s) => sectionKey(s.kind, s.targetKey)));
    if (wantedSections(targets, data).every((w) => have.has(sectionKey(w.kind, w.targetKey)))) return;
    ensuring.current = true;
    ensureSections(report, targets, data, sections)
      .then((created) => {
        qc.setQueryData<ReportSection[]>(reportSectionsKey(report.id), (list = []) => [
          ...list.filter((s) => !created.some((c) => c.id === s.id)),
          ...created,
        ]);
      })
      .catch((e: unknown) => {
        reportError(e);
        // Sections created before the failure are stored: reload the list so the outline shows them.
        void qc.invalidateQueries({ queryKey: reportSectionsKey(report.id) });
        setEnsureFailed(RavenError.from(e).message);
      })
      .finally(() => {
        ensuring.current = false;
      });
  }, [report, targets, data, sections, qc, ensureFailed]);
  return { ensureFailed, retryEnsure: () => setEnsureFailed(null) };
}

/**
 * Flattens the open page once as it opens when it holds old nodes, saving it through `replacePage`. Returns the
 * flatten's error when the page doesn't fit the plain schema (it then never mounts), else null.
 */
export function useOpenFlatten(
  openSection: ReportSection | undefined,
  cachedSection: (s: ReportSection) => ReportSection,
  plainOf: (doc: ReportNode, target: ReportTarget | undefined) => ReportNode,
  targetOf: (s: ReportSection) => ReportTarget | undefined,
  replacePage: (doc: ReportNode, meta: SectionMeta) => void,
): string | null {
  const qc = useQueryClient();
  // Pages flattened as they opened in this view: each is flattened and saved once.
  const flattenSaved = useRef(new Set<string>());
  /** The open page as the open-time flatten writes it, checked as Restore checks the page it swaps in; null for a page
   *  that needs no flatten. One that doesn't fit (`error`) is never saved over the stored page. */
  const openFlatten = useMemo((): { id: string; original: ReportNode; doc: ReportNode; error: string | null } | null => {
    const s = openSection;
    const original = s ? cachedSection(s).doc : null;
    if (!s || !original || !needsFlatten(original)) return null;
    const doc = plainOf(original, targetOf(s));
    try {
      reportSchema().nodeFromJSON(doc).check();
      return { id: s.id, original, doc, error: null };
    } catch (e) {
      return { id: s.id, original, doc, error: RavenError.from(e).message };
    }
  }, [openSection, cachedSection, plainOf, targetOf]);
  const flattenFailed = openFlatten?.error ?? null;
  useEffect(() => {
    const s = openSection;
    if (!s || !hasCurrentPage(s) || flattenSaved.current.has(s.id)) return;
    if (!openFlatten || openFlatten.id !== s.id || openFlatten.error !== null) return;
    flattenSaved.current.add(s.id);
    const { original, doc } = openFlatten;
    const cached = cachedSection(s);
    const was = cached.meta as SectionMeta;
    // The page as stored goes into the archive. It becomes `previousDoc` (Restore) only when no earlier page holds that
    // place: a page kept from a rebuild stays the one Restore brings back.
    const originals = archivePage(was, original, "flatten");
    const meta: SectionMeta = was.previousDoc
      ? { ...was, originals }
      : { ...was, previousDoc: original, previousLayout: was.layout ?? null, previousAt: Date.now(), restored: false, flattened: true, originals };
    patchCachedSection(qc, s.id, { doc, meta: meta as Record<string, unknown> });
    replacePage(doc, meta);
  }, [openSection, openFlatten, cachedSection, qc, replacePage]);
  return flattenFailed;
}

/**
 * Builds the open section's plain draft from `drafts` when it has no current page. `draftFailed` is the open section's
 * failed build's message, kept per section so one page's failure stops no other (`retryDraft` tries that page again); `draftBlocked` the section whose rebuild waits on an unsaved change (`retryBlocked`
 * tries again, `rebuildAnyway` rebuilds with the change kept in the archived old page).
 */
export function useDraftBuild(
  openSection: ReportSection | undefined,
  drafts: Map<string, ReportNode>,
  reportId: string,
  cachedSection: (s: ReportSection) => ReportSection,
) {
  const qc = useQueryClient();
  // A section opened with no page yet, or one under another layout, gets its plain draft, built and stored once
  // (draftBuiltAt marks it).
  const building = useRef(new Set<string>());
  // Failed builds' messages, by section id.
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map());
  // A section whose rebuild waits on an earlier change to its old page that isn't saved (failed or refused).
  const [draftBlocked, setDraftBlocked] = useState<string | null>(null);
  // Sections the owner asked to rebuild anyway: their unsaved change goes into the archived old page instead.
  const rebuildAnyway = useRef(new Set<string>());
  useEffect(() => {
    const s = openSection;
    if (!s || hasCurrentPage(s) || s.kind === "details" || failed.has(s.id) || draftBlocked === s.id || building.current.has(s.id)) return;
    const doc = drafts.get(s.id);
    if (!doc) return;
    building.current.add(s.id);
    const fail = (e: unknown) => {
      building.current.delete(s.id);
      reportError(e);
      setFailed((was) => new Map(was).set(s.id, RavenError.from(e).message));
    };
    // Rebuild anyway: once a write of it already on its way has settled (so it can't land after the rebuild), the
    // unsaved change is dropped from the queue (it is never tried again) and lives on in the archived old page below
    // (the queue patched the cache with it when it sent it). Should the rebuild fail, it is queued again.
    let requeue: (() => void) | null = null;
    const flushed = rebuildAnyway.current.delete(s.id)
      ? settleReportSave(s.id).then(() => {
          if (isReportSaveQueued(s.id)) {
            const unsaved = cachedSection(s);
            forgetReportSave(s.id);
            requeue = () => queueReportSave(qc, s.id, unsaved.doc as ReportNode, unsaved.meta as SectionMeta);
          }
          return flushReports();
        })
      : // A queued write of the old page (mid-debounce, or failed and waiting for its retry; a refused one is tried once
        // more) goes out first, so it can never land after the rebuild and overwrite it; the page it wrote is the one kept.
        flushReports();
    flushed
      .then(() => {
        // The section as the cache has it after the flush: the queue patches it with every write it sends, so its page
        // and meta are the latest, saved or not; its position is the current one (the reply's is left out of the cache,
        // so a reorder made meanwhile stays).
        const now = cachedSection(s);
        if (isReportSaveQueued(s.id)) {
          requeue?.();
          building.current.delete(s.id);
          setDraftBlocked(s.id);
          return;
        }
        if (hasCurrentPage(now)) {
          building.current.delete(s.id);
          return;
        }
        // A page written under another layout is never dropped: it is kept for "Restore your previous page" and, byte for
        // byte with its meta, in the archive. The owner's own meta (coverage, removed entries) carries forward.
        const was = now.meta as SectionMeta;
        // The removals carried forward (the cache's, the latest) leave their entries off the page, so they survive.
        const page = withoutRemoved(doc, was.removedEntryIds ?? []);
        const meta: SectionMeta =
          now.doc != null
            ? {
                ...ownerMeta(was),
                layout: DRAFT_LAYOUT,
                previousDoc: now.doc,
                previousLayout: was.layout ?? null,
                previousAt: Date.now(),
                originals: archivePage(was, now.doc, "rebuild"),
              }
            : { ...ownerMeta(was), layout: DRAFT_LAYOUT, ...(was.originals ? { originals: was.originals } : {}) };
        return api
          .reportSectionUpsert(reportId, { kind: s.kind, targetKey: s.targetKey, position: now.position, doc: page, meta: meta as Record<string, unknown>, draftBuiltAt: Date.now() })
          .then((saved) => patchCachedSection(qc, s.id, { doc: saved.doc, meta: saved.meta, draftBuiltAt: saved.draftBuiltAt }))
          .catch((e: unknown) => {
            requeue?.();
            throw e;
          });
      })
      .catch(fail);
  }, [openSection, drafts, reportId, qc, failed, draftBlocked, cachedSection]);
  const openId = openSection?.id;
  return {
    draftFailed: openId === undefined ? null : (failed.get(openId) ?? null),
    retryDraft: () => {
      if (openId === undefined) return;
      setFailed((was) => {
        const next = new Map(was);
        next.delete(openId);
        return next;
      });
    },
    draftBlocked,
    retryBlocked: () => setDraftBlocked(null),
    rebuildAnyway: (id: string) => {
      rebuildAnyway.current.add(id);
      setDraftBlocked(null);
    },
  };
}
