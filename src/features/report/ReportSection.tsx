import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Editor } from "prosekit/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import {
  buildSectionDraft,
  buildTargetDraft,
  captionOf,
  DRAFT_LAYOUT,
  expectedFlags,
  isFigure,
  isReady,
  isValidOsid,
  numberAppendices,
  reportChecks,
  reportDueAt,
  reportFileName,
  reportTargets,
  SECTION_NAMES,
  sectionNumbers,
  subsectionNumbers,
  targetChecks,
  targetHeadings,
  type AppendixEntry,
  type AppendixIndex,
  type Check,
  type FlagKind,
  type ReportData,
  type ReportMeta,
  type ReportNode,
  type ReportTarget,
  type SectionMeta,
} from "../../engines/report";
import { api } from "../../lib/api";
import { isDialogOpen, isFreeKey, useKeydown } from "../../lib/keys";
import { useNarrow } from "../../lib/useNarrow";
import { reportError } from "../../lib/lockSignal";
import type { Report, ReportPatch, ReportSection } from "../../types/report";
import type { Settings } from "../../types/settings";
import { Button, Disclosure, EmptyState, ErrorState, LoadingState, queryState, Select, usePageShortcuts, type Hint } from "../../ui";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useNotesStore } from "../notes/useNotesStore";
import { usePayloadsStore } from "../payloads/usePayloadsStore";
import { ReportDataContext, type ReportDataValue } from "./editor/ReportDataContext";
import { AppendixSection, type AppendixPageEntry } from "./editor/AppendixSection";
import { openFindBar, posAtPath, ReportEditor, selectBlockAt, setNodeAttrs } from "./editor/ReportEditor";
import { AddEvidenceButton } from "./AddEvidenceButton";
import { EvidenceDrawer, EvidenceRail } from "./EvidenceRail";
import { ReportDetails } from "./ReportDetails";
import { CheckList, ExpectedFlags, focusOutlineRow, ReportOutline, type CheckAction, type OutlineItem, type TargetState } from "./ReportOutline";
import { ReportStrip } from "./ReportStrip";
import {
  BACK_KINDS,
  ensureSections,
  FRONT_KINDS,
  hasCurrentPage,
  hasEngagementTested,
  patchCachedSection,
  reportKey,
  reportSectionsKey,
  sectionKey,
  useReport,
  useReportData,
  useReportSections,
  useSectionSaver,
  wantedSections,
} from "./queries";
import { trackReportWrite, useReportSaveStore } from "./saveQueue";

const HINTS: Hint[] = [
  { keys: "J K", label: "move in the outline", priority: 1 },
  { keys: "↵", label: "open", priority: 2 },
  { keys: "⌥↑ ⌥↓", label: "reorder targets", priority: 3 },
  { keys: "⌥1–3", label: "outline, page, evidence", priority: 4 },
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
];
/** Under 1200px the evidence rail is a drawer, which E opens. */
const NARROW_HINTS: Hint[] = [...HINTS, { keys: "E", label: "evidence", priority: 5 }];
const RAIL_BREAKPOINT = 1200;

const LABEL = SECTION_NAMES;

const GENERATED_TITLE: Record<string, string> = {
  "port-scan": "Port Scan Results",
  tested: "Also tested",
  "attack-chain": "Attack chain",
};

const EMPTY_DOC: ReportNode = { type: "doc", content: [] };

/** An appendix entry's title: the entry's or file's own, or the table's name. */
function appendixTitle(node: ReportNode, data: ReportData): string {
  const a = node.attrs ?? {};
  if (node.type === "evidence") return data.log.find((e) => e.id === a.entryId)?.title ?? "Evidence";
  if (node.type === "exploit") return data.findingFiles.find((f) => f.id === a.fileId)?.name ?? "Exploit code";
  return GENERATED_TITLE[String(a.kind)] ?? "Table";
}

/** Figures a section's page shows, in the editor's own terms (`isFigure`). */
function countFigures(doc: ReportNode, data: ReportData): number {
  const entryOf = (id: string) => data.log.find((e) => e.id === id);
  let n = 0;
  const walk = (node: ReportNode) => {
    if (isFigure(node, entryOf)) n++;
    node.content?.forEach(walk);
  };
  walk(doc);
  return n;
}

/** Under this natural width a screenshot is upscaled or tiny at page width (spec §6.5). */
const MIN_PRINT_WIDTH = 600;

/** Soft checks for screenshots on the page whose loaded image is too narrow to print legibly. */
function legibilityChecks(doc: ReportNode, data: ReportData, widths: Record<string, number>): Check[] {
  const out: Check[] = [];
  const walk = (node: ReportNode) => {
    const id = node.type === "evidence" ? String(node.attrs?.entryId ?? "") : "";
    const width = widths[id];
    if (width !== undefined && width < MIN_PRINT_WIDTH && !out.some((c) => c.id === `legible:${id}`)) {
      const entry = data.log.find((e) => e.id === id);
      const name = (entry && captionOf(node.attrs, entry)) || "A screenshot";
      out.push({
        id: `legible:${id}`,
        level: "soft",
        text: `The screenshot "${name}" is narrower than would print legibly. Retake it larger or crop it tighter.`,
        anchor: { entryId: id },
      });
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

/** The node at an index path ("0.2.1") of a stored page. */
function nodeAtPath(doc: ReportNode, path: string): ReportNode | null {
  let node: ReportNode | undefined = doc;
  for (const part of path.split(".")) node = node?.content?.[Number(part)];
  return node ?? null;
}

/** A target's appendix page (letters from A): the target and its moved entries, in page order. */
interface AppendixPage {
  id: string;
  label: string;
  /** The target as the appendix names it: "lnx02", "AD set (ad02, dc01)". */
  name: string;
  entry: Entry;
  entries: AppendixEntry[];
}

const APPENDIX_ID = "appendix:";

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

/** The appendix index, kept as the same object while its entries are unchanged, so node views don't re-render per keystroke. */
function useStableAppendix(index: AppendixIndex): AppendixIndex {
  const sig = JSON.stringify(index.entries);
  const [kept, setKept] = useState({ sig, index });
  if (kept.sig !== sig) {
    setKept({ sig, index });
    return index;
  }
  return kept.index;
}

const lastOctet = (ip: string | null | undefined) => (ip && ip.includes(".") ? `.${ip.split(".").pop()}` : undefined);

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
  return { onChange, onRemoveEvidence, onRestoreEvidence };
}

/** The engagement's Report section: client engagements get a placeholder this round. */
export function ReportSectionView() {
  const { id = "" } = useParams();
  const engagement = useQuery({ queryKey: ["engagement", id], queryFn: () => api.engagementGet(id) });
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

interface Entry {
  item: OutlineItem;
  section: ReportSection;
  target?: ReportTarget;
}

function ReportWorkspace({ eid }: { eid: string }) {
  const qc = useQueryClient();
  const reportQ = useReport(eid);
  const dataQ = useReportData(eid);
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
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
  const reportMeta = report.meta as ReportMeta;
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
        setEnsureFailed(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        ensuring.current = false;
      });
  }, [report, targets, data, sections, qc, ensureFailed]);

  // The outline, in §5.7 order. Sections whose target is gone (deleted host, unticked lab host) are hidden, never deleted.
  const entries = useMemo((): Entry[] => {
    const byKey = new Map(sections.map((s) => [sectionKey(s.kind, s.targetKey), s]));
    const out: Entry[] = [];
    const detailsMissing = !report.candidateName.trim() || !report.email.trim() || !isValidOsid(report.osid.trim());
    for (const kind of FRONT_KINDS) {
      const s = byKey.get(sectionKey(kind, null));
      if (s) out.push({ section: s, item: { id: s.id, group: "report", label: LABEL[kind]!, warn: kind === "details" && detailsMissing } });
    }
    const standalone = targets.filter((t) => t.kind === "standalone");
    const order = new Map(standalone.map((t, i) => [t.key, i]));
    const targetSections = sections
      .filter((s) => s.kind === "target" && s.targetKey !== null && order.has(s.targetKey))
      .sort((a, b) => a.position - b.position || order.get(a.targetKey!)! - order.get(b.targetKey!)!);
    for (const s of targetSections) {
      const target = standalone.find((t) => t.key === s.targetKey)!;
      const host = data.hosts.find((h) => h.id === target.key);
      out.push({ section: s, target, item: { id: s.id, group: "targets", label: host?.name ?? "Host", octet: lastOctet(host?.ip), reorderable: true } });
    }
    const ad = targets.find((t) => t.kind === "ad-set");
    const adSection = byKey.get(sectionKey("ad", "ad-set"));
    if (ad && adSection) {
      const names = ad.hostIds.map((id) => data.hosts.find((h) => h.id === id)?.name).filter(Boolean);
      out.push({ section: adSection, target: ad, item: { id: adSection.id, group: "targets", label: `AD set: ${names.join(", ")}` } });
    }
    const tested = byKey.get(sectionKey("engagement-tested", null));
    if (tested && hasEngagementTested(data)) out.push({ section: tested, item: { id: tested.id, group: "targets", label: LABEL["engagement-tested"]! } });
    for (const kind of BACK_KINDS) {
      const s = byKey.get(sectionKey(kind, null));
      if (s) out.push({ section: s, item: { id: s.id, group: "closing", label: LABEL[kind]! } });
    }
    return out;
  }, [sections, targets, data, report]);

  // First drafts for sections not built yet, or built with an older layout (rebuilt from scratch: the owner confirmed
  // nothing written before layout 2 needs keeping): what their page will hold, so checks and numbering read it already.
  const drafts = useMemo(() => {
    const out = new Map<string, ReportNode>();
    for (const e of entries) {
      if (hasCurrentPage(e.section) || e.section.kind === "details") continue;
      out.set(e.section.id, e.target ? buildTargetDraft(data, e.target, reportMeta) : buildSectionDraft(e.section.kind, data, settings));
    }
    return out;
  }, [entries, data, reportMeta, settings]);

  // Every section's stored page (or the draft it will get). Only the open page changes per keystroke; it is read live.
  const savedDocOf = useCallback(
    (s: ReportSection): ReportNode => drafts.get(s.id) ?? (s.doc as ReportNode | null) ?? EMPTY_DOC,
    [drafts],
  );
  const appendixDocs = useCallback(
    (docOf: (s: ReportSection) => ReportNode) =>
      numberAppendices(
        entries.map((e) => ({ id: e.section.id, kind: e.section.kind, targetKey: e.section.targetKey, doc: e.section.kind === "details" ? null : docOf(e.section) })),
        (n) => appendixTitle(n, data),
      ),
    [entries, data],
  );
  const savedAppendix = useMemo(() => appendixDocs(savedDocOf), [appendixDocs, savedDocOf]);
  // Each target with moved content has an appendix page, lettered from A (spec §5.6).
  const appendixPagesOf = useCallback(
    (index: AppendixIndex): AppendixPage[] =>
      entries.flatMap((e) => {
        const list = e.target ? index.entries.filter((a) => a.sectionId === e.section.id) : [];
        if (list.length === 0 || !e.target) return [];
        // "lnx02", or "AD set (ad02, dc01)" for the AD set.
        const name =
          e.target.kind === "ad-set"
            ? `AD set (${e.target.hostIds.map((id) => data.hosts.find((h) => h.id === id)?.name ?? "Host").join(", ")})`
            : e.item.label;
        return [{ id: `${APPENDIX_ID}${e.section.id}`, label: `Appendix ${list[0].letter}: ${name}`, name, entry: e, entries: list }];
      }),
    [entries, data],
  );

  // The open section: the one picked, else the first target, else the first item. An open appendix page has none.
  const [openId, setOpenId] = useState<string | null>(null);
  const openAppendix = openId?.startsWith(APPENDIX_ID) ? appendixPagesOf(savedAppendix).find((p) => p.id === openId) : undefined;
  const open = openAppendix ? undefined : (entries.find((e) => e.item.id === openId) ?? entries.find((e) => e.target) ?? entries[0]);
  const openSection = open?.section;

  // The open page as it is now (typed but maybe not saved yet) and its meta.
  const [live, setLive] = useState<{ id: string; doc: ReportNode } | null>(null);
  const [liveMeta, setLiveMeta] = useState<{ id: string; meta: SectionMeta } | null>(null);

  const metaOf = useCallback(
    (s: ReportSection): SectionMeta => (liveMeta?.id === s.id ? liveMeta.meta : (s.meta as SectionMeta)),
    [liveMeta],
  );
  const openLiveDoc = openSection && live?.id === openSection.id ? live.doc : null;

  // With the open page live, so references stay right while editing; kept as the same object while its entries don't change.
  const appendix = useStableAppendix(
    useMemo(
      () => (openLiveDoc && openSection ? appendixDocs((s) => (s.id === openSection.id ? openLiveDoc : savedDocOf(s))) : savedAppendix),
      [openLiveDoc, openSection, appendixDocs, savedDocOf, savedAppendix],
    ),
  );

  // Other targets' checks read their stored pages; only the open target's are recomputed as you type.
  const savedChecks = useMemo(() => {
    const out = new Map<string, Check[]>();
    for (const e of entries) {
      if (!e.target) continue;
      out.set(
        e.section.id,
        targetChecks({ data, target: e.target, doc: savedDocOf(e.section), meta: reportMeta, appendixRefs: savedAppendix, sectionId: e.section.id, coverage: (e.section.meta as SectionMeta).coverage }),
      );
    }
    return out;
  }, [entries, data, savedDocOf, reportMeta, savedAppendix]);
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
      ...targetChecks({ data, target: openTarget, doc, meta: reportMeta, appendixRefs: appendix, sectionId: openSection.id, coverage: openSectionMeta?.coverage }),
      ...legibilityChecks(doc, data, shotWidths),
    ];
  }, [openTarget, openSection, data, openLiveDoc, savedDocOf, reportMeta, appendix, openSectionMeta, shotWidths]);
  const checks = useMemo(
    () => (openChecksLive && openSection ? new Map(savedChecks).set(openSection.id, openChecksLive) : savedChecks),
    [savedChecks, openChecksLive, openSection],
  );
  const reportLevel = useMemo(() => reportChecks({ report, targets, data }), [report, targets, data]);

  const targetEntries = entries.filter((e) => e.target);
  const readyCount = targetEntries.filter((e) => isReady(checks.get(e.section.id) ?? [])).length;
  const gaps = [...checks.values(), reportLevel].reduce((n, list) => n + list.filter((c) => c.level === "fail").length, 0);
  const stateOf = (t: ReportTarget, sectionId: string): TargetState => {
    const started = data.log.some((l) => !l.private && l.hostIds.some((h) => t.hostIds.includes(h)));
    if (!started) return "not-started";
    return isReady(checks.get(sectionId) ?? []) ? "ready" : "gaps";
  };
  // Appendix pages follow the fixed appendices, before the closing sections; they follow the live page.
  const appendixPages = appendixPagesOf(appendix);
  const sectionItems = entries.map((e) => (e.target ? { ...e.item, state: stateOf(e.target, e.section.id) } : e.item));
  const closingAt = sectionItems.findIndex((i) => i.group === "closing");
  const pageItems: OutlineItem[] = appendixPages.map((p) => ({ id: p.id, group: "appendices", label: p.label }));
  const items = closingAt === -1 ? [...sectionItems, ...pageItems] : [...sectionItems.slice(0, closingAt), ...pageItems, ...sectionItems.slice(closingAt)];
  const openItemId = openAppendix?.id ?? open?.item.id ?? null;

  const figureOffset = useMemo(() => {
    let n = 0;
    for (const e of entries) {
      if (e.section.id === openSection?.id) break;
      if (e.section.kind !== "details") n += countFigures(savedDocOf(e.section), data);
    }
    return n;
  }, [entries, openSection?.id, savedDocOf, data]);

  // Page numbers and titles from the outline order (OffSec's sample: 1, 2, 3, then 4.N per target), never stored.
  const numbers = useMemo(() => sectionNumbers(entries.filter((e) => e.section.kind !== "details").map((e) => ({ id: e.section.id, kind: e.section.kind }))), [entries]);
  const openNumber = openSection ? numbers.get(openSection.id) : undefined;
  const pageSubNumbers = useMemo(() => {
    const kind = openSection?.kind;
    const n = openNumber?.number;
    return kind && n && kind !== "target" && kind !== "ad" ? (doc: ReportNode) => subsectionNumbers(kind, n, doc) : undefined;
  }, [openSection?.kind, openNumber?.number]);
  const standaloneOrdinal = open?.target?.kind === "standalone" ? entries.filter((e) => e.target?.kind === "standalone").findIndex((e) => e === open) + 1 : 0;
  const headingsOf = useMemo(() => {
    const target = open?.target;
    const base = openNumber?.number;
    if (!target || !base) return undefined;
    return (doc: ReportNode) => targetHeadings(doc, data, target, base, standaloneOrdinal);
  }, [open?.target, openNumber?.number, data, standaloneOrdinal]);

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

  const { onChange, onRemoveEvidence, onRestoreEvidence } = usePageEdits(openSection, savedDocOf, saver, setLive, setLiveMeta);
  // An appendix page reads the stored pages: write the open page first, so a block moved a moment ago is on it.
  const openItem = (id: string) => {
    if (id.startsWith(APPENDIX_ID)) void saver.flush();
    setOpenId(id);
  };
  // An appendix entry's link back: the block to select once its section's page has mounted.
  const pendingPick = useRef<{ id: string; path: string } | null>(null);
  const onEditorReady = (id: string, editor: Editor) => {
    editorRef.current = { id, editor };
    setReadyEditor({ id, editor });
    const pick = pendingPick.current;
    if (pick?.id !== id) return;
    pendingPick.current = null;
    const pos = posAtPath(editor.state.doc, pick.path);
    if (pos !== null) selectBlockAt(editor, pos);
  };

  // A section opened with no page yet gets its first draft, built and stored once (draftBuiltAt marks it).
  const building = useRef(new Set<string>());
  const [draftFailed, setDraftFailed] = useState<string | null>(null);
  useEffect(() => {
    const s = openSection;
    if (!s || hasCurrentPage(s) || s.kind === "details" || draftFailed || building.current.has(s.id)) return;
    const doc = drafts.get(s.id);
    if (!doc) return;
    building.current.add(s.id);
    // The position as the sections cache has it now; the reply's position is left out of the cache, so a reorder
    // made while the draft was on its way stays.
    const position = qc.getQueryData<ReportSection[]>(reportSectionsKey(report.id))?.find((x) => x.id === s.id)?.position ?? s.position;
    api
      .reportSectionUpsert(report.id, { kind: s.kind, targetKey: s.targetKey, position, doc, meta: { layout: DRAFT_LAYOUT } satisfies SectionMeta, draftBuiltAt: Date.now() })
      .then((saved) => patchCachedSection(qc, s.id, { doc: saved.doc, meta: saved.meta, draftBuiltAt: saved.draftBuiltAt }))
      .catch((e: unknown) => {
        building.current.delete(s.id);
        reportError(e);
        setDraftFailed(e instanceof Error ? e.message : String(e));
      });
  }, [openSection, drafts, report.id, qc, draftFailed]);

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
    const cached = (qc.getQueryData<Report>(reportKey(report.engagementId))?.meta ?? report.meta) as ReportMeta;
    saveReport({ meta: { expectedFlags: { ...(cached.expectedFlags ?? {}), [hostId]: flags } } });
  };

  const reorder = useCallback(
    (id: string, dir: -1 | 1) => {
      const movable = entries.filter((e) => e.item.reorderable).map((e) => e.section.id);
      const at = movable.indexOf(id);
      const to = at + dir;
      if (at === -1 || to < 0 || to >= movable.length) return;
      [movable[at], movable[to]] = [movable[to], movable[at]];
      // Every section gets a position: the outline order with the moved targets, then the hidden ones as they were.
      const shown = entries.map((e) => (e.item.reorderable ? movable.shift()! : e.section.id));
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

  // Keys: J/K move in the outline; ⌥1/⌥2/⌥3 focus the outline, the page and the evidence column.
  const navRef = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const [sectionRef, narrow] = useNarrow<HTMLElement>(RAIL_BREAKPOINT);
  const [railOpen, setRailOpen] = useState(false);
  const [railFocus, setRailFocus] = useState(0);
  // The evidence drawer shares the right edge with Notes, Arsenal and Payloads: opening one slides the other out.
  const toggleRail = (open: boolean) => {
    if (open) {
      useNotesStore.getState().close();
      useArsenalStore.getState().close();
      usePayloadsStore.getState().close();
    }
    setRailOpen(open);
  };
  useEffect(() => useNotesStore.subscribe((st) => { if (st.open) setRailOpen(false); }), []);
  useEffect(() => useArsenalStore.subscribe((st) => { if (st.open) setRailOpen(false); }), []);
  useEffect(() => usePayloadsStore.subscribe((st) => { if (st.open) setRailOpen(false); }), []);
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
    focusOutlineRow(navRef.current, e.key.toLowerCase() === "j" ? 1 : -1, from);
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
    const pane = { Digit1: "outline", Digit2: "page", Digit3: "rail" }[e.code];
    if (!pane) return;
    e.preventDefault();
    if (pane === "outline") focusOutlineRow(navRef.current, 0);
    else if (pane === "rail") {
      if (narrow) {
        toggleRail(true);
        setRailFocus((n) => n + 1);
      }
      else railRef.current?.focus();
    }
    else if (openEditor()) openEditor()!.focus();
    else pageRef.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
  });

  // A check takes the page to the block it concerns and selects it.
  const pickCheck = (check: Check) => {
    const editor = openEditor();
    if (!editor) return;
    const doc = editor.state.doc;
    // A suggested move names its block by index path (`move:0.3`).
    let pos: number | null = check.id.startsWith("move:") ? posAtPath(doc, check.id.slice("move:".length)) : null;
    let index = 0;
    if (pos === null)
      doc.descendants((node, p) => {
        if (pos !== null) return false;
        const hit =
          check.anchor?.entryId !== undefined
            ? node.type.name === "evidence" && node.attrs.entryId === check.anchor.entryId
            : check.anchor?.nodeIndex !== undefined && index === check.anchor.nodeIndex;
        index++;
        if (hit) pos = p;
        return true;
      });
    if (pos !== null) selectBlockAt(editor, pos);
    else editor.view.focus();
  };
  // A suggested move's fix is the Move action itself: the block goes to the appendix, leaving its reference.
  const checkAction = (check: Check): CheckAction | undefined => {
    if (!check.id.startsWith("move:")) return undefined;
    const path = check.id.slice("move:".length);
    return {
      label: "Move to appendix",
      run: () => {
        const editor = openEditor();
        const pos = editor ? posAtPath(editor.state.doc, path) : null;
        if (editor && pos !== null) setNodeAttrs(editor, pos, { appendix: "moved" });
      },
    };
  };

  const openChecks = open?.target ? (checks.get(open.section.id) ?? []) : [];
  const machines = open?.target ? open.target.hostIds.map((id) => ({ hostId: id, name: data.hosts.find((h) => h.id === id)?.name ?? "Host" })) : [];
  const targetExtra = open?.target ? (
    <>
      <CheckList checks={openChecks} onPick={pickCheck} actionFor={checkAction} />
      <ExpectedFlags machines={machines} flagsOf={(id) => expectedFlags(open.target!, id, reportMeta)} onChange={setFlags} />
    </>
  ) : undefined;

  const contextValue = useMemo(
    (): ReportDataValue | null =>
      openSectionMeta
        ? {
            data,
            appendix,
            sectionMeta: openSectionMeta,
            onRemoveEvidence,
            reportMeta,
            figureOffset,
            onImageWidth,
            canMove: Boolean(openTarget),
            headingsOf,
            target: openTarget,
          }
        : null,
    [data, appendix, openSectionMeta, onRemoveEvidence, reportMeta, figureOffset, onImageWidth, openTarget, headingsOf],
  );

  const notStarted = open?.target && stateOf(open.target, open.section.id) === "not-started";
  const appendixView = openAppendix ? (
    <AppendixSection
      key={openAppendix.id}
      title={openAppendix.label}
      source={openAppendix.name}
      entries={openAppendix.entries.flatMap((a): AppendixPageEntry[] => {
        const path = a.key.slice(openAppendix.entry.section.id.length + 1);
        const node = nodeAtPath(savedDocOf(openAppendix.entry.section), path);
        return node ? [{ ref: `${a.letter}.${a.n}`, title: a.title, path, node }] : [];
      })}
      ctx={{ data, appendix: savedAppendix, sectionMeta: metaOf(openAppendix.entry.section), onRemoveEvidence: () => {}, reportMeta }}
      onBack={(path) => {
        pendingPick.current = { id: openAppendix.entry.section.id, path };
        setOpenId(openAppendix.entry.section.id);
      }}
    />
  ) : null;
  const includedHostIds = targets.flatMap((t) => t.hostIds);
  const [checksOpen, setChecksOpen] = useState(false);
  const railDoc = openSection ? (openLiveDoc ?? savedDocOf(openSection)) : EMPTY_DOC;
  const rail = (
    <EvidenceRail
      target={open?.target}
      data={data}
      doc={railDoc}
      editor={readyEditor && readyEditor.id === openSection?.id ? readyEditor.editor : null}
      didWell={openSection?.kind === "summary"}
      onInserted={onRestoreEvidence}
    />
  );
  const fails = openChecks.filter((c) => c.level === "fail").length;
  // With a page open its bar comes first (wide, flush with the pane's top edge) and these lines sit under it.
  const editorShown = !appendixView && openSection?.kind !== "details" && !!openSection && hasCurrentPage(openSection) && !!contextValue;
  const notices = (
    <>
      {ensureFailed && <WarnLine text={`Couldn't add the report's new sections: ${ensureFailed}`} retryLabel="Retry setting up sections" onRetry={() => setEnsureFailed(null)} />}
      {saveRefused ? (
        <p role="alert" className="m-0 text-meta text-warn">
          {saveRefused}
        </p>
      ) : (
        saveFailed && <p className="m-0 text-meta text-warn">Some typing isn't saved yet. Raven keeps trying; keep Raven open until this goes.</p>
      )}
      {draftFailed && <WarnLine text={`Couldn't build this page's draft: ${draftFailed}`} retryLabel="Retry building the draft" onRetry={() => setDraftFailed(null)} />}
      {notStarted && open?.target && <p className="m-0 text-meta text-muted-2">Nothing logged on {open.item.label} yet. The page fills in as you work.</p>}
    </>
  );

  return (
    <section ref={sectionRef} aria-label="Report" className="@container/report grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <ReportStrip
        fileName={reportFileName(report.osid.trim())}
        osidValid={isValidOsid(report.osid.trim())}
        dueAt={reportDueAt(data.engagement, reportMeta)}
        ready={readyCount}
        targets={targetEntries.length}
        gaps={gaps}
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
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] @min-[1000px]/report:grid-cols-[272px_minmax(0,1fr)] @min-[1200px]/report:grid-cols-[272px_minmax(0,1fr)_320px]">
          <div className="hidden min-h-0 overflow-y-auto border-r border-line @min-[1000px]/report:block">
            <ReportOutline
              items={items}
              openId={openItemId}
              onOpen={openItem}
              onReorder={reorder}
              openExtra={targetExtra}
              navRef={(el) => {
                navRef.current = el;
              }}
            />
          </div>
          <div ref={pageRef} className="grid min-h-0 content-start gap-4 overflow-y-auto px-6 py-6">
            <div className="grid gap-2 @min-[1000px]/report:hidden">
              <Select
                aria-label="Report section"
                options={items.map((i) => ({ value: i.id, label: i.label }))}
                value={openItemId ?? undefined}
                onValueChange={openItem}
              />
              {open?.target && (
                <Disclosure label="Checks" count={fails} open={checksOpen} onOpenChange={setChecksOpen}>
                  {targetExtra}
                </Disclosure>
              )}
            </div>
            {!editorShown && notices}
            {appendixView ?? (openSection?.kind === "details" ? (
              <ReportDetails
                key={report.id}
                report={report}
                engagement={data.engagement}
                hosts={data.hosts}
                includedHostIds={includedHostIds}
                onSave={saveReport}
              />
            ) : openSection && contextValue ? (
              hasCurrentPage(openSection) ? (
                <ReportDataContext.Provider value={contextValue}>
                  <ReportEditor
                    key={openSection.id}
                    sectionId={openSection.id}
                    title={openNumber?.title?.text}
                    titleNumber={openNumber?.title?.number ?? undefined}
                    subNumbers={pageSubNumbers}
                    doc={openSection.doc as ReportNode}
                    onChange={onChange}
                    onReady={(editor) => onEditorReady(openSection.id, editor)}
                    toolbarClassName="@min-[1000px]/report:-mt-6"
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
              ) : draftFailed ? null : (
                <LoadingState label="the draft" />
              )
            ) : null)}
          </div>
          {narrow ? (
            <EvidenceDrawer open={railOpen} focusKey={railFocus} onClose={() => setRailOpen(false)}>
              {rail}
            </EvidenceDrawer>
          ) : (
            <aside
              ref={railRef}
              tabIndex={-1}
              aria-label="Evidence"
              className="hidden min-h-0 content-start overflow-y-auto border-l border-line px-4 py-4 outline-none @min-[1200px]/report:grid"
            >
              {rail}
            </aside>
          )}
        </div>
      )}
    </section>
  );
}
