import { useQueryClient } from "@tanstack/react-query";
import type { Editor } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import {
  archivePage,
  buildPlainTarget,
  buildSectionDraft,
  legibilityChecks,
  DRAFT_LAYOUT,
  expectedFlags,
  flattenToPlain,
  isAppendixPage,
  isReady,
  isValidOsid,
  needsFlatten,
  numberAppendices,
  ownerMeta,
  reportChecks,
  reportDueAt,
  reportFileName,
  reportTargets,
  SECTION_NAMES,
  sectionNumbers,
  subsectionNumbers,
  targetChecks,
  targetNumbers,
  withoutRemoved,
  type Check,
  type FlagKind,
  type PageMeta,
  type ReportData,
  type ReportNode,
  type ReportTarget,
  type SectionMeta,
} from "../../engines/report";
import { api } from "../../lib/api";
import { isDialogOpen, isFreeKey, useKeydown } from "../../lib/keys";
import { cx } from "../../lib/cx";
import { useWidthRef } from "../../lib/useWidth";
import { reportError } from "../../lib/lockSignal";
import type { Report, ReportPatch, ReportSection } from "../../types/report";
import type { Settings } from "../../types/settings";
import { Button, Dialog, EmptyState, ErrorState, LoadingState, queryState, TimedNotice, usePageShortcuts, type Hint } from "../../ui";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useNotesStore } from "../notes/useNotesStore";
import { usePayloadsStore } from "../payloads/usePayloadsStore";
import { reportSchema } from "./editor/extension";
import { ReportDataContext, type ReportDataValue } from "./editor/ReportDataContext";
import { keepCopiedText, openFindBar, posAtPath, ReportEditor, selectBlockAt } from "./editor/ReportEditor";
import { AddEvidenceButton } from "./AddEvidenceButton";
import { EvidenceDrawer, EvidenceRail } from "./EvidenceRail";
import { GuidePanel } from "./GuidePanel";
import { ReportDetails } from "./ReportDetails";
import { ReportStrip } from "./ReportStrip";
import { focusReportTab, PartTabs, ReportTabs, type TabItem } from "./ReportTabs";
import { ExpectedFlags, TodoPanel, type CheckAction } from "./TodoPanel";
import {
  BACK_KINDS,
  createPage,
  deletePage,
  ensureSections,
  FRONT_KINDS,
  hasCurrentPage,
  hasEngagementTested,
  patchCachedSection,
  reportKey,
  reportSectionsKey,
  renamePage,
  restorePage,
  sectionKey,
  useReport,
  useReportData,
  useReportSections,
  useSectionSaver,
  wantedSections,
  pageTitle,
} from "./queries";
import { flushReports, forgetReportSave, isReportSaveQueued, queueReportSave, settleReportSave, trackReportWrite, useReportSaveStore } from "./saveQueue";
import { useSettings } from "../settings/queries";
import { useEngagement } from "../engagements/queries";
import { RavenError } from "../../types/errors";

const HINTS: Hint[] = [
  { keys: "← →", label: "move along the tabs (J K from anywhere)", priority: 1 },
  { keys: "↵", label: "open the tab", priority: 2 },
  { keys: "⌥← ⌥→", label: "reorder targets and pages", priority: 3 },
  { keys: "⌥1–3", label: "tabs, page, evidence", priority: 4 },
  { keys: "⌘↵", label: "insert evidence", priority: 6 },
  { keys: "/", label: "insert on the page", priority: 7 },
  { keys: "⌘F", label: "find and replace", priority: 8 },
  // ⌘K is search, so the page's link key takes Shift.
  { keys: "⌘⇧K", label: "link", priority: 9 },
  { keys: "⌘B ⌘I ⌘U", label: "bold, italic, underline", priority: 10 },
  { keys: "⌘⇧S ⌘E ⌘⇧H", label: "strikethrough, code, highlight", priority: 11 },
  { keys: "⌥⌘1 ⌥⌘2 ⌥⌘3 ⌥⌘0", label: "heading 1, 2, 3, paragraph", priority: 12 },
  { keys: "# ## ###", label: "at a line's start: heading 1, 2, 3", priority: 13 },
  { keys: "- 1. []", label: "at a line's start: bulleted, numbered, task list", priority: 14 },
  { keys: "> ``` ---", label: "at a line's start: quote, code block, divider", priority: 15 },
  { keys: "F2 ⌫", label: "on a page's tab: rename, delete", priority: 16 },
];
/** Under 1200px the evidence column is the owner's to open and close, with E. */
const NARROW_HINTS: Hint[] = [...HINTS, { keys: "E", label: "evidence", priority: 5 }];
/** From this pane width the evidence column always sits beside the page. */
const RAIL_BREAKPOINT = 1200;
/** From this pane width (and under 1200) the column, when open, docks beside the page and the paper narrows: 320px of
 *  column still leaves the paper about 560px of text. Narrower, the column is a drawer over the page. */
const DOCK_BREAKPOINT = 1000;
/** Where the evidence column sits: always beside the page, beside it while open, or a drawer over it while open. */
type RailMode = "column" | "dock" | "drawer";
const railModeAt = (width: number): RailMode =>
  width === 0 || width >= RAIL_BREAKPOINT ? "column" : width >= DOCK_BREAKPOINT ? "dock" : "drawer";

const LABEL = SECTION_NAMES;

/** Front matter's and Closing's parts as their segmented rows name them (with the part's number, where it has one). */
const PART_LABEL: Partial<Record<string, string>> = {
  details: "Details",
  introduction: "Introduction",
  summary: "Summary",
  considerations: "Testing considerations",
  methodology: "Methodology",
  further: "Further information",
  references: "References",
  "engagement-tested": "Also tested",
};
/** Closing's parts in their row's order. */
const CLOSING_ORDER = ["further", "references", "engagement-tested"];
const FRONT_TAB = "tab:front";
const CLOSING_TAB = "tab:closing";

const EMPTY_DOC: ReportNode = { type: "doc", content: [] };

/** A warning with its Retry, above the page. */
function WarnLine({ text, retryLabel, onRetry }: { text: string; retryLabel: string; onRetry(): void }) {
  return (
    <div role="alert" className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
      <p className="m-0 text-meta text-warn">{text}</p>
      <Button size="sm" aria-label={retryLabel} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/**
 * The open page's edit handlers: every change queues an autosave of the page with its meta, and a removed evidence
 * block is remembered in `removedEntryIds` so "Add new evidence" won't bring it back.
 */
function usePageEdits(
  openSection: ReportSection | undefined,
  docOf: (s: ReportSection) => ReportNode,
  saver: { save(doc: ReportNode, meta: SectionMeta): void },
  setLive: (v: { id: string; doc: ReportNode }) => void,
  setLiveMeta: (v: { id: string; meta: SectionMeta }) => void,
) {
  // The latest page and meta of the open section, read by handlers that fire between renders.
  const current = useRef<{ id: string; doc: ReportNode; meta: SectionMeta } | null>(null);
  const onChange = useCallback(
    (doc: ReportNode) => {
      if (!openSection) return;
      const meta = current.current?.id === openSection.id ? current.current.meta : (openSection.meta as SectionMeta);
      current.current = { id: openSection.id, doc, meta };
      setLive({ id: openSection.id, doc });
      saver.save(doc, meta);
    },
    [openSection, saver, setLive],
  );
  const onRemoveEvidence = useCallback(
    (entryId: string) => {
      if (!openSection) return;
      const cur = current.current?.id === openSection.id ? current.current : { id: openSection.id, doc: docOf(openSection), meta: openSection.meta as SectionMeta };
      const removed = cur.meta.removedEntryIds ?? [];
      const meta: SectionMeta = { ...cur.meta, removedEntryIds: removed.includes(entryId) ? removed : [...removed, entryId] };
      current.current = { ...cur, meta };
      setLiveMeta({ id: openSection.id, meta });
      saver.save(cur.doc, meta);
    },
    [openSection, docOf, saver, setLiveMeta],
  );
  /** An entry went back onto the page: it is no longer "removed". */
  const onRestoreEvidence = useCallback(
    (entryId: string) => {
      if (!openSection) return;
      const cur = current.current?.id === openSection.id ? current.current : { id: openSection.id, doc: docOf(openSection), meta: openSection.meta as SectionMeta };
      if (!cur.meta.removedEntryIds?.includes(entryId)) return;
      const meta: SectionMeta = { ...cur.meta, removedEntryIds: cur.meta.removedEntryIds.filter((id) => id !== entryId) };
      current.current = { ...cur, meta };
      setLiveMeta({ id: openSection.id, meta });
      saver.save(cur.doc, meta);
    },
    [openSection, docOf, saver, setLiveMeta],
  );
  /**
   * Swaps the page with the one kept in the meta (`previousDoc`), given as `doc` in the plain schema: the page written
   * before a layout rebuild comes back, and the rebuilt one is kept in its place, so a second swap undoes it. The
   * restored page is stored under the current layout, so it is never rebuilt again. Returns the page now open, or null
   * when there is none to swap in.
   */
  const swapPrevious = useCallback(
    (doc: ReportNode): { doc: ReportNode; meta: SectionMeta } | null => {
      if (!openSection) return null;
      const cur = current.current?.id === openSection.id ? current.current : { id: openSection.id, doc: docOf(openSection), meta: openSection.meta as SectionMeta };
      if (!cur.meta.previousDoc) return null;
      // The page swapped out stays in the archive as it was, whatever later swaps do to `previousDoc`.
      const meta: SectionMeta = {
        ...cur.meta,
        layout: DRAFT_LAYOUT,
        previousDoc: cur.doc,
        restored: !cur.meta.restored,
        originals: archivePage(cur.meta, cur.doc, "restore"),
      };
      current.current = { id: openSection.id, doc, meta };
      setLive({ id: openSection.id, doc });
      setLiveMeta({ id: openSection.id, meta });
      saver.save(doc, meta);
      return { doc, meta };
    },
    [openSection, docOf, saver, setLive, setLiveMeta],
  );
  /** The open page becomes `doc` with `meta` (an old page flattened as it opens), saved like any change. */
  const replacePage = useCallback(
    (doc: ReportNode, meta: SectionMeta) => {
      if (!openSection) return;
      current.current = { id: openSection.id, doc, meta };
      setLive({ id: openSection.id, doc });
      setLiveMeta({ id: openSection.id, meta });
      saver.save(doc, meta);
    },
    [openSection, saver, setLive, setLiveMeta],
  );
  /** Merges `patch` into the open page's meta (a page's title) and saves it with the page as it is now. */
  const patchMeta = useCallback(
    (patch: Partial<SectionMeta> & Record<string, unknown>) => {
      if (!openSection) return;
      const cur = current.current?.id === openSection.id ? current.current : { id: openSection.id, doc: docOf(openSection), meta: openSection.meta as SectionMeta };
      const meta: SectionMeta = { ...cur.meta, ...patch };
      current.current = { ...cur, meta };
      setLiveMeta({ id: openSection.id, meta });
      saver.save(cur.doc, meta);
    },
    [openSection, docOf, saver, setLiveMeta],
  );
  return { onChange, onRemoveEvidence, onRestoreEvidence, swapPrevious, replacePage, patchMeta };
}

/** The engagement's Report section: client engagements get a placeholder this round. */
export function ReportSectionView() {
  const { id = "" } = useParams();
  const engagement = useEngagement(id);
  if (!engagement.data) return <Padded>{queryState([engagement], "the report")}</Padded>;
  if (engagement.data.kind === "client") {
    return (
      <Padded>
        <EmptyState title="Client reports come after the exam" body="This round builds the OSCP exam report. Client reports arrive in a later round." />
      </Padded>
    );
  }
  return <ReportWorkspace eid={id} />;
}

/** The section's states (loading, empty, error) keep the margins the shell gives other sections; the report itself runs edge to edge. */
const Padded = ({ children }: { children: ReactNode }) => <div className="px-6 py-6">{children}</div>;

/** Which tab a section sits under: Front matter's parts, the targets, Closing's parts, or a page of its own (a free
 *  page after the targets, an appendix page after the targets' appendices). */
type EntryGroup = "front" | "targets" | "pages" | "closing" | "appendix-pages";

interface Entry {
  item: { id: string; group: EntryGroup; label: string; reorderable?: boolean };
  section: ReportSection;
  target?: ReportTarget;
}

function ReportWorkspace({ eid }: { eid: string }) {
  const qc = useQueryClient();
  const reportQ = useReport(eid);
  const dataQ = useReportData(eid);
  const settingsQ = useSettings();
  const sectionsQ = useReportSections(reportQ.data?.id);

  const failed = reportQ.error ?? dataQ.error ?? settingsQ.error ?? sectionsQ.error;
  if (failed) {
    return (
      <Padded>
      <ErrorState
        title="Couldn't load the report"
        hint="Retry. If it keeps failing, lock and unlock Raven."
        onRetry={() => {
          void reportQ.refetch();
          void settingsQ.refetch();
          void sectionsQ.refetch();
          dataQ.refetch();
        }}
        detail={failed.message}
      />
      </Padded>
    );
  }
  if (!reportQ.data || !dataQ.data || !settingsQ.data || !sectionsQ.data) {
    return (
      <Padded>
        <LoadingState label="the report" />
      </Padded>
    );
  }
  if (dataQ.data.hosts.length === 0) {
    return (
      <Padded>
        <EmptyState title="No hosts yet" body="The report builds itself from your hosts and their log. Add a host to start." />
      </Padded>
    );
  }
  return <ReportBody report={reportQ.data} data={dataQ.data} settings={settingsQ.data} sections={sectionsQ.data} qc={qc} />;
}

function ReportBody({
  report,
  data,
  settings,
  sections,
  qc,
}: {
  report: Report;
  data: ReportData;
  settings: Settings;
  sections: ReportSection[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const reportMeta = report.meta;
  const targets = useMemo(() => reportTargets(data, reportMeta), [data, reportMeta]);
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

  // The report's sections in §5.7 order (numbering, figures and appendix letters follow it). Sections whose target is
  // gone (deleted host, unticked lab host) are hidden, never deleted.
  const entries = useMemo((): Entry[] => {
    const byKey = new Map(sections.map((s) => [sectionKey(s.kind, s.targetKey), s]));
    const out: Entry[] = [];
    for (const kind of FRONT_KINDS) {
      const s = byKey.get(sectionKey(kind, null));
      if (s) out.push({ section: s, item: { id: s.id, group: "front", label: LABEL[kind]! } });
    }
    const standalone = targets.filter((t) => t.kind === "standalone");
    const order = new Map(standalone.map((t, i) => [t.key, i]));
    const targetSections = sections
      .filter((s) => s.kind === "target" && s.targetKey !== null && order.has(s.targetKey))
      .sort((a, b) => a.position - b.position || order.get(a.targetKey!)! - order.get(b.targetKey!)!);
    for (const s of targetSections) {
      const target = standalone.find((t) => t.key === s.targetKey)!;
      const host = data.hosts.find((h) => h.id === target.key);
      out.push({ section: s, target, item: { id: s.id, group: "targets", label: host?.name ?? "Host", reorderable: true } });
    }
    const ad = targets.find((t) => t.kind === "ad-set");
    const adSection = byKey.get(sectionKey("ad", "ad-set"));
    if (ad && adSection) out.push({ section: adSection, target: ad, item: { id: adSection.id, group: "targets", label: "AD set" } });
    // Owner-written pages (+ Page), each group in its own order (position).
    const pages = sections.filter((s) => s.kind === "page").sort((a, b) => a.position - b.position);
    const pageEntry = (s: ReportSection, group: EntryGroup): Entry => ({
      section: s,
      item: { id: s.id, group, label: (s.meta as Partial<PageMeta>).title || pageTitle(isAppendixPage(s) ? "appendix" : "body"), reorderable: true },
    });
    for (const s of pages) if (!isAppendixPage(s)) out.push(pageEntry(s, "pages"));
    const tested = byKey.get(sectionKey("engagement-tested", null));
    if (tested && hasEngagementTested(data)) out.push({ section: tested, item: { id: tested.id, group: "closing", label: LABEL["engagement-tested"]! } });
    for (const kind of BACK_KINDS) {
      const s = byKey.get(sectionKey(kind, null));
      if (s) out.push({ section: s, item: { id: s.id, group: "closing", label: LABEL[kind]! } });
    }
    for (const s of pages) if (isAppendixPage(s)) out.push(pageEntry(s, "appendix-pages"));
    return out;
  }, [sections, targets, data]);

  // Plain first drafts for sections not built yet, or built with another layout (rebuilt from scratch; the page written
  // before is kept in the meta, `previousDoc`): what their page will hold, so checks and numbering read it already.
  const drafts = useMemo(() => {
    const out = new Map<string, ReportNode>();
    for (const e of entries) {
      if (hasCurrentPage(e.section) || e.section.kind === "details" || e.section.kind === "page") continue;
      // What the owner took off the page before (its removed entries, carried forward) stays off the rebuilt page.
      const removed = (e.section.meta as SectionMeta | null)?.removedEntryIds ?? [];
      out.set(e.section.id, e.target ? withoutRemoved(buildPlainTarget(data, e.target, reportMeta), removed) : buildSectionDraft(e.section.kind, data, settings, reportMeta));
    }
    return out;
  }, [entries, data, reportMeta, settings]);

  // A stored page holding old nodes (an owner page, a page restored before plain pages) as the page reads it: flattened.
  const plainOf = useCallback(
    (doc: ReportNode, target: ReportTarget | undefined): ReportNode => (needsFlatten(doc) ? flattenToPlain(doc, data, target ?? null, reportMeta) : doc),
    [data, reportMeta],
  );
  const targetOf = useCallback((s: ReportSection) => entries.find((e) => e.section.id === s.id)?.target, [entries]);

  // Every section's stored page (or the draft it will get), in the plain schema. Only the open page changes per
  // keystroke; it is read live.
  const savedDocOf = useCallback(
    (s: ReportSection): ReportNode => drafts.get(s.id) ?? (s.doc ? plainOf(s.doc, targetOf(s)) : EMPTY_DOC),
    [drafts, plainOf, targetOf],
  );
  // Appendix pages' letters (+ Page, placement appendix): a plain page moves nothing out, so these are the only appendices.
  const appendix = useMemo(
    () => numberAppendices(entries.map((e) => ({ id: e.section.id, kind: e.section.kind, meta: e.section.meta, position: e.section.position }))),
    [entries],
  );

  // The open section: the one picked, else the first target, else the first item.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = entries.find((e) => e.item.id === openId) ?? entries.find((e) => e.target) ?? entries[0];
  const openSection = open?.section;

  // The open page as it is now (typed but maybe not saved yet) and its meta.
  const [live, setLive] = useState<{ id: string; doc: ReportNode } | null>(null);
  const [liveMeta, setLiveMeta] = useState<{ id: string; meta: SectionMeta } | null>(null);

  const metaOf = useCallback(
    (s: ReportSection): SectionMeta => (liveMeta?.id === s.id ? liveMeta.meta : (s.meta as SectionMeta)),
    [liveMeta],
  );
  const openLiveDoc = openSection && live?.id === openSection.id ? live.doc : null;

  // Other targets' checks read their stored pages; only the open target's are recomputed as you type.
  const savedChecks = useMemo(() => {
    const out = new Map<string, Check[]>();
    for (const e of entries) {
      if (!e.target) continue;
      out.set(
        e.section.id,
        targetChecks({ data, target: e.target, doc: savedDocOf(e.section), meta: reportMeta, sectionId: e.section.id, coverage: (e.section.meta as SectionMeta).coverage }),
      );
    }
    return out;
  }, [entries, data, savedDocOf, reportMeta]);
  const openTarget = open?.target;
  const openSectionMeta = openSection ? metaOf(openSection) : undefined;
  // Screenshots' natural widths as their images load on the open page: view state for the legibility check, never stored.
  const [shotWidths, setShotWidths] = useState<Record<string, number>>({});
  const onImageWidth = useCallback(
    (entryId: string, width: number) => setShotWidths((was) => (was[entryId] === width ? was : { ...was, [entryId]: width })),
    [],
  );
  const openChecksLive = useMemo(() => {
    if (!openTarget || !openSection) return null;
    const doc = openLiveDoc ?? savedDocOf(openSection);
    return [
      ...targetChecks({ data, target: openTarget, doc, meta: reportMeta, sectionId: openSection.id, coverage: openSectionMeta?.coverage }),
      ...legibilityChecks(doc, data, shotWidths),
    ];
  }, [openTarget, openSection, data, openLiveDoc, savedDocOf, reportMeta, openSectionMeta, shotWidths]);
  const allChecks = useMemo(
    () => (openChecksLive && openSection ? new Map(savedChecks).set(openSection.id, openChecksLive) : savedChecks),
    [savedChecks, openChecksLive, openSection],
  );
  // What the owner dismissed from To do (false positives) is left out of every count and list; the panel lists it apart.
  const checks = useMemo(() => {
    const out = new Map<string, Check[]>();
    for (const e of entries) {
      const list = allChecks.get(e.section.id);
      if (!list) continue;
      const off = new Set(metaOf(e.section).dismissedChecks ?? []);
      out.set(e.section.id, off.size === 0 ? list : list.filter((c) => !off.has(c.id)));
    }
    return out;
  }, [allChecks, entries, metaOf]);
  const allReportLevel = useMemo(() => reportChecks({ report, targets, data }), [report, targets, data]);
  const reportLevel = useMemo(() => {
    const off = new Set(reportMeta.dismissedChecks ?? []);
    return off.size === 0 ? allReportLevel : allReportLevel.filter((c) => !off.has(c.id));
  }, [allReportLevel, reportMeta]);

  const targetEntries = entries.filter((e) => e.target);
  const readyCount = targetEntries.filter((e) => isReady(checks.get(e.section.id) ?? [])).length;
  const failsIn = (list: Check[]) => list.filter((c) => c.level === "fail").length;
  const gaps = [...checks.values(), reportLevel].reduce((n, list) => n + failsIn(list), 0);
  const started = (t: ReportTarget) => data.log.some((l) => !l.private && l.hostIds.some((h) => t.hostIds.includes(h)));

  // A page's title as it is now (a rename of the open page is in its live meta before it is saved).
  const pageTitleOf = (s: ReportSection) => (metaOf(s) as Partial<PageMeta>).title || pageTitle(isAppendixPage(s) ? "appendix" : "body");
  // Page numbers and titles from the outline order (OffSec's sample: 1, 2, 3, then 4.N per target), never stored.
  const numbers = useMemo(
    () =>
      sectionNumbers(
        entries
          .filter((e) => e.section.kind !== "details")
          .map((e) => ({ id: e.section.id, kind: e.section.kind, meta: e.section.kind === "page" ? metaOf(e.section) : undefined })),
      ),
    [entries, metaOf],
  );
  const pageLetter = (id: string) => appendix.pages?.find((p) => p.sectionId === id)?.letter ?? "?";

  // The tab row (§10.1): Front matter, the targets in grading order, the free pages, Closing, then the appendix pages.
  // Front matter and Closing each hold several sections, switched by their segmented row.
  const frontParts = entries.filter((e) => e.item.group === "front");
  const closingParts = entries
    .filter((e) => e.item.group === "closing")
    .sort((a, b) => CLOSING_ORDER.indexOf(a.section.kind) - CLOSING_ORDER.indexOf(b.section.kind));
  const groupOf = (e: Entry | undefined): string | null => (e?.item.group === "front" ? FRONT_TAB : e?.item.group === "closing" ? CLOSING_TAB : (e?.section.id ?? null));
  const tabs: TabItem[] = [];
  if (frontParts.length > 0) {
    const fails = failsIn(reportLevel);
    tabs.push({ id: FRONT_TAB, label: "Front matter", state: fails > 0 ? "todo" : "ready", todo: fails });
  }
  targetEntries.forEach((e, i) => {
    const fails = failsIn(checks.get(e.section.id) ?? []);
    const state: TabItem["state"] = !started(e.target!) ? "not-started" : fails > 0 ? "todo" : "ready";
    tabs.push({ id: e.section.id, label: `${i + 1} ${e.item.label}`, state, todo: fails, reorderable: e.item.reorderable });
  });
  for (const e of entries.filter((x) => x.item.group === "pages")) {
    const title = pageTitleOf(e.section);
    tabs.push({ id: e.section.id, label: title, state: "none", detail: `Section ${numbers.get(e.section.id)?.number ?? ""}`, page: true, title, reorderable: true });
  }
  if (closingParts.length > 0) tabs.push({ id: CLOSING_TAB, label: "Closing", state: "none" });
  for (const e of entries.filter((x) => x.item.group === "appendix-pages")) {
    const title = pageTitleOf(e.section);
    tabs.push({ id: e.section.id, label: `Appendix ${pageLetter(e.section.id)}`, state: "none", detail: title, page: true, title, reorderable: true });
  }
  const openTabId = groupOf(open) ?? "";

  const openNumber = openSection ? numbers.get(openSection.id) : undefined;
  // The title at the top of the page: an appendix page is "Appendix C – <title>", unnumbered.
  const openTitle: { text?: string; number?: string } =
    openSection && isAppendixPage(openSection)
      ? { text: `Appendix ${pageLetter(openSection.id)} – ${pageTitleOf(openSection)}` }
      : { text: openNumber?.title?.text, number: openNumber?.title?.number ?? undefined };
  // Numbered headings: a target page's machine headings ("4.1"; "5.1", "5.2" in the AD set), a report-level page's
  // sub-sections ("3.1").
  const pageSubNumbers = useMemo(() => {
    const kind = openSection?.kind;
    const n = openNumber?.number;
    if (!kind || !n) return undefined;
    if (openTarget) return (doc: ReportNode) => targetNumbers(doc, openTarget, n);
    return (doc: ReportNode) => subsectionNumbers(kind, n, doc);
  }, [openSection?.kind, openNumber?.number, openTarget]);

  // Autosave, flushed when the open section changes and on leaving.
  const saveFailed = useReportSaveStore((s) => s.unsaved);
  const saveRefused = useReportSaveStore((s) => s.refused);
  const saver = useSectionSaver(openSection?.id ?? "");
  const editorRef = useRef<{ id: string; editor: Editor } | null>(null);
  // The same editor as state too, so the evidence rail re-renders once the page has mounted.
  const [readyEditor, setReadyEditor] = useState<{ id: string; editor: Editor } | null>(null);
  /** The open page's editor; null on Report details or before the page mounts. */
  const openId_ = openSection?.id;
  const openEditor = useCallback(
    () => (editorRef.current && editorRef.current.id === openId_ ? editorRef.current.editor : null),
    [openId_],
  );

  const { onChange, onRemoveEvidence, onRestoreEvidence, swapPrevious, replacePage, patchMeta } = usePageEdits(openSection, savedDocOf, saver, setLive, setLiveMeta);
  // Each swap with the previous page remounts the editor on the page swapped in (it reads its document once).
  const [swaps, setSwaps] = useState(0);
  // The stored page a section opens with: the sections cache as it is now, which the save queue patches with every write.
  // The `sections` prop reaches this view a render later, so a page opened (or swapped) right after a change would
  // otherwise mount on its older document and save over the change.
  const cachedSection = useCallback(
    (s: ReportSection): ReportSection => qc.getQueryData<ReportSection[]>(reportSectionsKey(report.id))?.find((x) => x.id === s.id) ?? s,
    [qc, report.id],
  );
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
  /** The document a page mounts with, in the plain schema. A stored page holding old nodes (an owner page, a page
   *  restored before plain pages) opens flattened; the effect below saves it once, the original kept in `previousDoc`. */
  const openDoc = (s: ReportSection): ReportNode => plainOf(cachedSection(s).doc as ReportNode, targetOf(s));
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
  const [swapFailed, setSwapFailed] = useState<string | null>(null);
  const swapPage = () => {
    const s = openSection;
    const prev = (s && metaOf(s).previousDoc) || null;
    const editor = openEditor();
    if (!s || !prev || !editor) return;
    // The page swapped in is written in the plain schema; should it still not fit the page, say so rather than break it.
    const plain = flattenToPlain(prev, data, open?.target ?? null, reportMeta);
    try {
      editor.schema.nodeFromJSON(plain).check();
    } catch (e) {
      setSwapFailed(RavenError.from(e).message);
      return;
    }
    setSwapFailed(null);
    const next = swapPrevious(plain);
    if (!next) return;
    patchCachedSection(qc, s.id, { doc: next.doc, meta: next.meta as Record<string, unknown> });
    setSwaps((n) => n + 1);
  };
  // Front matter and Closing reopen on the part last shown in them.
  const lastPart = useRef<Partial<Record<string, string>>>({});
  const openItem = (id: string) => {
    const group = groupOf(entries.find((e) => e.section.id === id));
    if (group === FRONT_TAB || group === CLOSING_TAB) lastPart.current[group] = id;
    setOpenId(id);
  };
  const openTab = (id: string) => {
    if (id === FRONT_TAB || id === CLOSING_TAB) {
      const parts = id === FRONT_TAB ? frontParts : closingParts;
      const last = lastPart.current[id];
      openItem(parts.some((p) => p.section.id === last) ? last! : parts[0].section.id);
    } else openItem(id);
  };
  const onEditorReady = (id: string, editor: Editor) => {
    editorRef.current = { id, editor };
    setReadyEditor({ id, editor });
  };

  // A section opened with no page yet, or one under another layout, gets its plain draft, built and stored once
  // (draftBuiltAt marks it).
  const building = useRef(new Set<string>());
  const [draftFailed, setDraftFailed] = useState<string | null>(null);
  // A section whose rebuild waits on an earlier change to its old page that isn't saved (failed or refused).
  const [draftBlocked, setDraftBlocked] = useState<string | null>(null);
  // Sections the owner asked to rebuild anyway: their unsaved change goes into the archived old page instead.
  const rebuildAnyway = useRef(new Set<string>());
  useEffect(() => {
    const s = openSection;
    if (!s || hasCurrentPage(s) || s.kind === "details" || draftFailed || draftBlocked === s.id || building.current.has(s.id)) return;
    const doc = drafts.get(s.id);
    if (!doc) return;
    building.current.add(s.id);
    const fail = (e: unknown) => {
      building.current.delete(s.id);
      reportError(e);
      setDraftFailed(RavenError.from(e).message);
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
          .reportSectionUpsert(report.id, { kind: s.kind, targetKey: s.targetKey, position: now.position, doc: page, meta: meta as Record<string, unknown>, draftBuiltAt: Date.now() })
          .then((saved) => patchCachedSection(qc, s.id, { doc: saved.doc, meta: saved.meta, draftBuiltAt: saved.draftBuiltAt }))
          .catch((e: unknown) => {
            requeue?.();
            throw e;
          });
      })
      .catch(fail);
  }, [openSection, drafts, report.id, qc, draftFailed, draftBlocked, cachedSection]);

  // Report-details writes go out one at a time, in order; only the last one's reply reaches the cache, so a slower
  // earlier reply never overwrites a later change.
  const reportWrites = useRef<{ chain: Promise<unknown>; last: number }>({ chain: Promise.resolve(), last: 0 });
  const saveReport = useCallback(
    (patch: ReportPatch) => {
      const key = reportKey(report.engagementId);
      const before = qc.getQueryData<Report>(key);
      const merged: ReportPatch = patch.meta && before ? { ...patch, meta: { ...before.meta, ...patch.meta } } : patch;
      if (before) qc.setQueryData<Report>(key, { ...before, ...merged } as Report);
      const writes = reportWrites.current;
      const n = ++writes.last;
      writes.chain = writes.chain
        .then(() => api.reportUpdate(report.id, merged))
        .then((saved) => {
          if (n === writes.last) qc.setQueryData(key, saved);
        })
        .catch((e: unknown) => {
          reportError(e);
          void qc.invalidateQueries({ queryKey: key });
        });
      // A lock waits for it, as it does for the pages.
      trackReportWrite(writes.chain);
    },
    [qc, report.engagementId, report.id],
  );
  const setFlags = (hostId: string, flags: FlagKind[]) => {
    const cached = qc.getQueryData<Report>(reportKey(report.engagementId))?.meta ?? report.meta;
    saveReport({ meta: { expectedFlags: { ...(cached.expectedFlags ?? {}), [hostId]: flags } } });
  };

  const reorder = useCallback(
    (id: string, dir: -1 | 1) => {
      // Targets reorder among the targets, free pages among the free pages, appendix pages among the appendix pages.
      const group = entries.find((e) => e.section.id === id)?.item.group;
      const inGroup = (e: Entry) => e.item.reorderable && e.item.group === group;
      const movable = entries.filter(inGroup).map((e) => e.section.id);
      const at = movable.indexOf(id);
      const to = at + dir;
      if (at === -1 || to < 0 || to >= movable.length) return;
      [movable[at], movable[to]] = [movable[to], movable[at]];
      // Every section gets a position: the outline order with the moved ones swapped, then the hidden ones as they were.
      const shown = entries.map((e) => (inGroup(e) ? movable.shift()! : e.section.id));
      const hidden = [...sections].sort((a, b) => a.position - b.position).map((s) => s.id).filter((s) => !shown.includes(s));
      const ids = [...shown, ...hidden];
      qc.setQueryData<ReportSection[]>(reportSectionsKey(report.id), (list = []) =>
        list.map((s) => ({ ...s, position: ids.indexOf(s.id) })).sort((a, b) => a.position - b.position),
      );
      api.reportSectionsReorder(report.id, ids).catch((e: unknown) => {
        reportError(e);
        void qc.invalidateQueries({ queryKey: reportSectionsKey(report.id) });
      });
    },
    [entries, sections, qc, report.id],
  );

  // + Page (§10.4): a new page goes after every section (last among its kind) and opens.
  const addPage = (placement: PageMeta["placement"]) => {
    const cached = qc.getQueryData<ReportSection[]>(reportSectionsKey(report.id)) ?? sections;
    const position = cached.length === 0 ? 0 : Math.max(...cached.map((s) => s.position)) + 1;
    createPage(report, placement, position)
      .then((created) => {
        qc.setQueryData<ReportSection[]>(reportSectionsKey(report.id), (list = []) => [...list.filter((s) => s.id !== created.id), created]);
        openItem(created.id);
      })
      .catch(reportError);
  };
  const renameTo = (id: string, title: string) => {
    const s = sections.find((x) => x.id === id);
    if (!s) return;
    if (id === openSection?.id) patchMeta({ title });
    else renamePage(qc, s, title);
  };
  // Delete asks first; Undo brings the page back, from the kept copy, for this session.
  const [deleting, setDeleting] = useState<ReportSection | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<ReportSection | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const confirmDelete = () => {
    const s = deleting;
    if (!s || deleteBusy) return;
    setDeleteBusy(true);
    deletePage(qc, s)
      .then((kept) => {
        setDeleting(null);
        setDeleteError(null);
        if (openId === s.id) setOpenId(null);
        setDeleted(kept);
      })
      .catch((e: unknown) => {
        reportError(e);
        setDeleteError(RavenError.from(e).message);
      })
      .finally(() => setDeleteBusy(false));
  };
  const undoDelete = () => {
    const kept = deleted;
    setDeleted(null);
    if (!kept) return;
    restorePage(qc, kept)
      .then((back) => openItem(back.id))
      .catch(reportError);
  };
  const closeDeleted = useCallback(() => setDeleted(null), []);

  // Keys: J/K move along the tabs; ⌥1/⌥2/⌥3 focus the tab row, the page and the evidence column.
  const navRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const [sectionRef, paneWidth] = useWidthRef<HTMLElement>();
  const railMode = railModeAt(paneWidth);
  // Under 1200px the column is a toggle (the strip's Evidence button, E); docked or a drawer is the width's call.
  const narrow = railMode !== "column";
  const [railOpen, setRailOpen] = useState(false);
  const [railFocus, setRailFocus] = useState(0);
  // The column takes its own grid track (the paper narrows beside it): always when wide, while open when docked.
  const railBeside = railMode === "column" || (railMode === "dock" && railOpen);
  // The evidence drawer shares the right edge with Notes, Arsenal and Payloads: opening one slides the other out. A
  // docked column is part of the page's layout, as the wide column is, and stays.
  const toggleRail = (open: boolean) => {
    if (open && railMode === "drawer") {
      useNotesStore.getState().close();
      useArsenalStore.getState().close();
      usePayloadsStore.getState().close();
    }
    setRailOpen(open);
  };
  useEffect(() => {
    if (railMode !== "drawer") return;
    const closeDrawer = (st: { open: boolean }) => {
      if (st.open) setRailOpen(false);
    };
    const offs = [useNotesStore.subscribe(closeDrawer), useArsenalStore.subscribe(closeDrawer), usePayloadsStore.subscribe(closeDrawer)];
    return () => offs.forEach((off) => off());
  }, [railMode]);
  // ⌥3 on a docked column: open it, then focus it once it is drawn.
  useEffect(() => {
    if (railFocus > 0 && railMode === "dock") railRef.current?.focus();
    // Only a new ⌥3 moves focus, not a resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railFocus]);
  usePageShortcuts("Report", narrow ? NARROW_HINTS : HINTS);
  useKeydown((e) => {
    if (!narrow || !isFreeKey(e) || e.shiftKey || e.key.toLowerCase() !== "e") return;
    e.preventDefault();
    toggleRail(!railOpen);
  });
  useKeydown((e) => {
    if (!isFreeKey(e) || (e.key !== "j" && e.key !== "k" && e.key !== "J" && e.key !== "K")) return;
    e.preventDefault();
    const from = navRef.current?.contains(document.activeElement) ? document.activeElement : null;
    focusReportTab(navRef.current, e.key.toLowerCase() === "j" ? 1 : -1, from);
  });
  // ⌘F: the page's find bar, while focus is anywhere in the Report view (⌘K stays the app's search).
  useKeydown((e) => {
    if (!e.metaKey || e.altKey || e.ctrlKey || e.shiftKey || e.key.toLowerCase() !== "f" || e.defaultPrevented || isDialogOpen()) return;
    const editor = openEditor();
    if (!editor || !sectionRef.current?.contains(document.activeElement)) return;
    e.preventDefault();
    openFindBar(editor);
  });
  useKeydown((e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.defaultPrevented || isDialogOpen()) return;
    const pane = { Digit1: "tabs", Digit2: "page", Digit3: "rail" }[e.code];
    if (!pane) return;
    e.preventDefault();
    if (pane === "tabs") focusReportTab(navRef.current, 0);
    else if (pane === "rail") {
      if (narrow) {
        toggleRail(true);
        setRailFocus((n) => n + 1);
      } else railRef.current?.focus();
    }
    else if (openEditor()) openEditor()!.focus();
    else pageRef.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
  });

  // A check takes the page to the block it concerns and selects it.
  const pickCheck = (check: Check) => {
    // Report-level checks name a Front matter part: the details (name, email, OSID, a lab's hosts) or Methodology.
    const part = check.id === "msf-many" ? "methodology" : ["details", "osid", "no-targets"].includes(check.id) ? "details" : null;
    const partSection = part ? frontParts.find((e) => e.section.kind === part) : undefined;
    if (partSection) {
      openItem(partSection.section.id);
      return;
    }
    const editor = openEditor();
    if (!editor) return;
    const doc = editor.state.doc;
    // A suggested move names its block by index path (`move:0.3`).
    let pos: number | null = check.id.startsWith("move:") ? posAtPath(doc, check.id.slice("move:".length)) : null;
    // The anchor's node by its index in the page (the checks' own walk), else the first block from its entry: a figure
    // of it, or a block whose source names it.
    const { entryId, nodeIndex } = check.anchor ?? {};
    const fromEntry = (node: PMNode) =>
      (node.type.name === "figure" && node.attrs.entryId === entryId) ||
      (typeof node.attrs.source === "string" && /^entry:([^:]+)/.exec(node.attrs.source)?.[1] === entryId);
    let index = 0;
    if (pos === null)
      doc.descendants((node, p) => {
        if (pos !== null) return false;
        const hit = nodeIndex !== undefined ? index === nodeIndex : entryId !== undefined && fromEntry(node);
        index++;
        if (hit) pos = p;
        return true;
      });
    if (pos !== null) selectBlockAt(editor, pos);
    else editor.view.focus();
  };
  // Text copied from a now-private or deleted entry: Keep the text makes it the owner's own.
  const checkAction = (check: Check): CheckAction | undefined => {
    const copied = /^copied-(?:private|deleted):(.+)$/.exec(check.id);
    if (copied) {
      return {
        label: "Keep the text",
        run: () => {
          const editor = openEditor();
          if (editor) keepCopiedText(editor, copied[1]);
        },
      };
    }
    return undefined;
  };

  // The To do panel lists the open tab's checks: a target's own, Front matter's report-level ones.
  const [todoOpen, setTodoOpen] = useState(false);
  // What opened the panel (the strip's To do button or a tab): focus goes back there when it closes.
  const todoOpener = useRef<HTMLElement | null>(null);
  const openTodo = (opener: HTMLElement | null) => {
    todoOpener.current = opener;
    setTodoOpen(true);
  };
  const closeTodo = () => {
    setTodoOpen(false);
    const back = todoOpener.current;
    todoOpener.current = null;
    if (back?.isConnected) back.focus();
  };
  const openChecks = open?.target ? (checks.get(open.section.id) ?? []) : open?.item.group === "front" ? reportLevel : [];
  // The open tab's dismissed checks that still fire (a dismissal whose check stopped firing lists nothing).
  const shown = new Set(openChecks.map((c) => c.id));
  const openDismissed = (open?.target ? (allChecks.get(open.section.id) ?? []) : open?.item.group === "front" ? allReportLevel : []).filter((c) => !shown.has(c.id));
  /** Dismisses checks from the open tab's To do (`on`), or brings them back: a target's in its page meta, Front
   *  matter's in the report's. */
  const setDismissed = (ids: string[], on: boolean) => {
    const next = (was: string[] = []) => (on ? [...new Set([...was, ...ids])] : was.filter((id) => !ids.includes(id)));
    if (open?.target && openSection) patchMeta({ dismissedChecks: next(metaOf(openSection).dismissedChecks) });
    else if (open?.item.group === "front") {
      const cached = qc.getQueryData<Report>(reportKey(report.engagementId))?.meta ?? report.meta;
      saveReport({ meta: { dismissedChecks: next(cached.dismissedChecks) } });
    }
  };
  const machines = open?.target ? open.target.hostIds.map((id) => ({ hostId: id, name: data.hosts.find((h) => h.id === id)?.name ?? "Host" })) : [];
  const todoPanel = todoOpen ? (
    <TodoPanel
      className="row-start-2"
      checks={openChecks}
      others={tabs.filter((t) => t.id !== openTabId && (t.todo ?? 0) > 0).map((t) => ({ id: t.id, label: t.label, todo: t.todo ?? 0 }))}
      onOpenTab={openTab}
      onPick={pickCheck}
      actionFor={checkAction}
      dismissed={openDismissed}
      onDismiss={(ids) => setDismissed(ids, true)}
      onRestore={(ids) => setDismissed(ids, false)}
      onClose={closeTodo}
      flags={
        open?.target ? (
          <ExpectedFlags machines={machines} flagsOf={(id) => expectedFlags(open.target!, id, reportMeta)} onChange={setFlags} />
        ) : undefined
      }
    />
  ) : null;

  const contextValue = useMemo(
    (): ReportDataValue | null =>
      openSectionMeta
        ? {
            data,
            onRemoveEvidence,
            reportMeta,
            onImageWidth,
            target: openTarget,
          }
        : null,
    [data, openSectionMeta, onRemoveEvidence, reportMeta, onImageWidth, openTarget],
  );

  const notStarted = open?.target && !started(open.target);
  const includedHostIds = targets.flatMap((t) => t.hostIds);
  // Front matter's and Closing's segmented row, at the top of the page.
  const parts = open?.item.group === "front" ? frontParts : open?.item.group === "closing" ? closingParts : null;
  const partRow =
    parts && open ? (
      <div className="row-start-1 grid border-b border-line px-6 py-1">
        <PartTabs
          label={open.item.group === "front" ? "Front matter parts" : "Closing parts"}
          parts={parts.map((e) => {
            const number = numbers.get(e.section.id)?.number;
            const name = PART_LABEL[e.section.kind] ?? e.item.label;
            return { id: e.section.id, label: number ? `${number} ${name}` : name };
          })}
          openId={open.section.id}
          onOpen={openItem}
        />
      </div>
    ) : null;
  const railDoc = openSection ? (openLiveDoc ?? savedDocOf(openSection)) : EMPTY_DOC;
  const guides =
    openSection && openSection.kind !== "details" && hasCurrentPage(openSection) && contextValue ? (
      <GuidePanel key={openSection.id} kind={openSection.kind} placement={openSection.kind === "page" ? (openSection.meta as Partial<PageMeta>).placement : undefined} doc={railDoc} />
    ) : null;
  const rail = (
    <>
      {guides}
      <EvidenceRail
        target={open?.target}
        data={data}
        doc={railDoc}
        editor={readyEditor && readyEditor.id === openSection?.id ? readyEditor.editor : null}
        didWell={openSection?.kind === "summary"}
        meta={reportMeta}
        onInserted={onRestoreEvidence}
      />
    </>
  );
  // With a page open its bar comes first (wide, flush with the pane's top edge) and these lines sit under it.
  // A page whose conversion failed its check never mounts: nothing editable, so autosave can't write over the stored page.
  const editorShown = openSection?.kind !== "details" && !!openSection && hasCurrentPage(openSection) && !!contextValue && !flattenFailed;
  const notices = (
    <>
      {ensureFailed && <WarnLine text={`Couldn't add the report's new sections: ${ensureFailed}`} retryLabel="Retry setting up sections" onRetry={() => setEnsureFailed(null)} />}
      {saveRefused && (
        <p role="alert" className="m-0 text-meta text-warn">
          {`${entries.find((e) => e.section.id === saveRefused.sectionId)?.item.label ?? "A page"}: ${saveRefused.message}`}
        </p>
      )}
      {saveFailed && <p className="m-0 text-meta text-warn">Some typing isn't saved yet. Raven keeps trying; keep Raven open until this goes.</p>}
      {draftFailed && <WarnLine text={`Couldn't build this page's draft: ${draftFailed}`} retryLabel="Retry building the draft" onRetry={() => setDraftFailed(null)} />}
      {draftBlocked && draftBlocked === openSection?.id && (
        <div role="alert" className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3">
          <p className="m-0 text-meta text-warn">
            An earlier change to this page couldn't be saved, so Raven kept the old page and hasn't rebuilt it. Retry saves
            that change, then rebuilds. Rebuild anyway keeps the change in the old page, which Restore brings back.
          </p>
          <Button size="sm" onClick={() => setDraftBlocked(null)}>
            Retry
          </Button>
          <Button
            size="sm"
            onClick={() => {
              rebuildAnyway.current.add(draftBlocked);
              setDraftBlocked(null);
            }}
          >
            Rebuild anyway
          </Button>
        </div>
      )}
      {openSectionMeta?.previousDoc && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <p className="m-0 text-meta text-muted-2">
            {openSectionMeta.restored
              ? "This is your page from before the new layout."
              : openSectionMeta.flattened
                ? "This page was converted to the new format."
                : "This page was rebuilt for a new layout."}
          </p>
          {/* A page only converted to the new format holds the same words: nothing of the owner's to bring back. */}
          {(openSectionMeta.restored || !openSectionMeta.flattened) && (
            <Button size="sm" onClick={swapPage}>
              {openSectionMeta.restored ? "Use the rebuilt page" : "Restore your previous page"}
            </Button>
          )}
        </div>
      )}
      {swapFailed && <p role="alert" className="m-0 text-meta text-warn">{`Couldn't restore the previous page: ${swapFailed}`}</p>}
      {flattenFailed && (
        <p role="alert" className="m-0 text-meta text-warn">{`Couldn't convert this page to the new format, so it wasn't saved and the page as stored is unchanged: ${flattenFailed}`}</p>
      )}
      {notStarted && open?.target && <p className="m-0 text-meta text-muted-2">Nothing logged on {open.item.label} yet. The page fills in as you work.</p>}
    </>
  );

  return (
    <section ref={sectionRef} aria-label="Report" className="@container/report grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
      <ReportStrip
        fileName={reportFileName(report.osid.trim())}
        osidValid={isValidOsid(report.osid.trim())}
        dueAt={reportDueAt(data.engagement, reportMeta)}
        ready={readyCount}
        targets={targetEntries.length}
        todo={gaps}
        todoOpen={todoOpen}
        onTodo={(button) => (todoOpen ? closeTodo() : openTodo(button))}
        rail={narrow ? { open: railOpen, onToggle: () => toggleRail(!railOpen) } : undefined}
      />
      {entries.length === 0 ? (
        ensureFailed ? (
          <Padded>
            <ErrorState title="Couldn't set up the report" hint="Retry. If it keeps failing, lock and unlock Raven." onRetry={() => setEnsureFailed(null)} detail={ensureFailed} />
          </Padded>
        ) : (
          <Padded>
            <LoadingState label="the report" />
          </Padded>
        )
      ) : (
        <>
          <ReportTabs
            tabs={tabs}
            openId={openTabId}
            onOpen={openTab}
            onReorder={reorder}
            // A click doesn't focus a button in WebKit: the way back is the tab itself.
            onTodo={(id) => openTodo([...(navRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find((t) => t.dataset.id === id) ?? null)}
            onAddPage={addPage}
            onRenamePage={renameTo}
            onDeletePage={(id) => {
              const s = sections.find((x) => x.id === id);
              if (s) setDeleting(s);
            }}
            exportSlot={null}
            listRef={navRef}
          />
          <div className={cx("grid min-h-0", railBeside ? "grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-[minmax(0,1fr)]")}>
            <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
              {partRow}
              {todoPanel}
              <div ref={pageRef} className="row-start-3 grid min-h-0 content-start gap-4 overflow-y-auto px-6 py-6">
            {!editorShown && notices}
            {openSection?.kind === "details" ? (
              <ReportDetails
                key={report.id}
                report={report}
                engagement={data.engagement}
                hosts={data.hosts}
                includedHostIds={includedHostIds}
                onSave={saveReport}
              />
            ) : openSection && contextValue ? (
              flattenFailed ? null : hasCurrentPage(openSection) ? (
                <ReportDataContext.Provider value={contextValue}>
                  <ReportEditor
                    key={`${openSection.id}:${swaps}`}
                    title={openTitle.text}
                    titleNumber={openTitle.number}
                    subNumbers={pageSubNumbers}
                    doc={openDoc(openSection)}
                    onChange={onChange}
                    onReady={(editor) => onEditorReady(openSection.id, editor)}
                    toolbarClassName="-mt-6"
                    notices={notices}
                    toolbarEnd={
                      open?.target && (
                        <AddEvidenceButton
                          key={openSection.id}
                          editor={readyEditor && readyEditor.id === openSection.id ? readyEditor.editor : null}
                          data={data}
                          target={open.target}
                          meta={reportMeta}
                          removed={openSectionMeta?.removedEntryIds ?? []}
                          onAdded={() => void saver.flush()}
                        />
                      )
                    }
                  />
                </ReportDataContext.Provider>
              ) : draftFailed || draftBlocked === openSection.id ? null : (
                <LoadingState label="the draft" />
              )
            ) : null}
              </div>
            </div>
            {railMode === "drawer" ? (
              <EvidenceDrawer open={railOpen} focusKey={railFocus} onClose={() => setRailOpen(false)}>
                {rail}
              </EvidenceDrawer>
            ) : railBeside ? (
              <aside
                ref={railRef}
                tabIndex={-1}
                aria-label="Evidence"
                className="grid min-h-0 content-start overflow-y-auto border-l border-line px-4 py-4 outline-none"
              >
                {rail}
              </aside>
            ) : null}
          </div>
        </>
      )}
      <Dialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (o) return;
          setDeleting(null);
          setDeleteError(null);
        }}
        title={deleting ? `Delete ${pageTitleOf(deleting)}? Its text goes with it.` : ""}
        description={deleteError ? <span role="alert" className="text-warn">{deleteError}</span> : undefined}
        onCloseAutoFocus={(e) => {
          // Back to the tab row, on the open tab (the first target's after a delete of the open page).
          e.preventDefault();
          focusReportTab(navRef.current, 0);
        }}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" disabled={deleteBusy} onClick={confirmDelete}>
              Delete page
            </Button>
          </>
        }
      />
      {deleted && (
        <TimedNotice
          timerKey={deleted}
          onClose={closeDeleted}
          action={
            <Button size="sm" onClick={undoDelete}>
              Undo
            </Button>
          }
        >
          <p className="m-0 text-muted">{`Deleted ${pageTitleOf(deleted)}`}</p>
        </TimedNotice>
      )}
    </section>
  );
}
