import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Editor } from "prosekit/core";
import { NodeSelection } from "prosekit/pm/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import {
  buildSectionDraft,
  buildTargetDraft,
  expectedFlags,
  isFigure,
  isReady,
  isValidOsid,
  numberAppendices,
  reportChecks,
  reportDueAt,
  reportFileName,
  reportTargets,
  targetChecks,
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
import type { Report, ReportPatch, ReportSection, SectionKind } from "../../types/report";
import type { Settings } from "../../types/settings";
import { Button, Disclosure, EmptyState, ErrorState, LoadingState, queryState, Select, usePageShortcuts, type Hint } from "../../ui";
import { ReportDataContext, type ReportDataValue } from "./editor/ReportDataContext";
import { ReportEditor } from "./editor/ReportEditor";
import { EvidenceDrawer, EvidenceRail } from "./EvidenceRail";
import { ReportDetails } from "./ReportDetails";
import { CheckList, ExpectedFlags, focusOutlineRow, ReportOutline, type OutlineItem, type TargetState } from "./ReportOutline";
import { ReportStrip } from "./ReportStrip";
import {
  BACK_KINDS,
  ensureSections,
  FRONT_KINDS,
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

const HINTS: Hint[] = [
  { keys: "J K", label: "move in the outline", priority: 1 },
  { keys: "↵", label: "open", priority: 2 },
  { keys: "⌥↑ ⌥↓", label: "reorder targets", priority: 3 },
  { keys: "⌥1–3", label: "outline, page, evidence", priority: 4 },
];
/** Under 1200px the evidence rail is a drawer, which E opens. */
const NARROW_HINTS: Hint[] = [...HINTS, { keys: "E", label: "evidence", priority: 5 }];
const RAIL_BREAKPOINT = 1200;

const LABEL: Partial<Record<SectionKind, string>> = {
  details: "Report details",
  summary: "High-level summary",
  considerations: "Testing considerations",
  methodology: "Methodology",
  "engagement-tested": "Tested, not exploited",
  "appendix-proof": "Proof table",
  "appendix-tools": "Tools and payloads",
  "appendix-msf": "Metasploit usage",
  "appendix-cleanup": "House cleaning",
  further: "Further information",
  references: "References",
};

const GENERATED_TITLE: Record<string, string> = {
  services: "Services",
  tested: "Tested, not exploited",
  tools: "Tools and payloads",
  msf: "Metasploit usage",
  "attack-chain": "Attack chain",
  "proof-table": "Proof table",
  cleanup: "House cleaning",
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

/** A warning with its Retry, above the page. */
function WarnLine({ text, onRetry }: { text: string; onRetry(): void }) {
  return (
    <div role="alert" className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
      <p className="m-0 text-meta text-warn">{text}</p>
      <Button size="sm" onClick={onRetry}>
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
  if (!engagement.data) return queryState([engagement], "the report");
  if (engagement.data.kind === "client") {
    return <EmptyState title="Client reports come after the exam" body="This round builds the OSCP exam report. Client reports arrive in a later round." />;
  }
  return <ReportWorkspace eid={id} />;
}

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
    );
  }
  if (!reportQ.data || !dataQ.data || !settingsQ.data || !sectionsQ.data) return <LoadingState label="the report" />;
  if (dataQ.data.hosts.length === 0) {
    return <EmptyState title="No hosts yet" body="The report builds itself from your hosts and their log. Add a host to start." />;
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
      if (s) out.push({ section: s, item: { id: s.id, group: kind.startsWith("appendix-") ? "appendices" : "closing", label: LABEL[kind]!, auto: kind.startsWith("appendix-") } });
    }
    return out;
  }, [sections, targets, data, report]);

  // The open section: the one picked, else the first target, else the first item.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = entries.find((e) => e.item.id === openId) ?? entries.find((e) => e.target) ?? entries[0];
  const openSection = open?.section;

  // The open page as it is now (typed but maybe not saved yet) and its meta.
  const [live, setLive] = useState<{ id: string; doc: ReportNode } | null>(null);
  const [liveMeta, setLiveMeta] = useState<{ id: string; meta: SectionMeta } | null>(null);

  // First drafts for sections not built yet: what their page will hold, so checks and numbering read it already.
  const drafts = useMemo(() => {
    const out = new Map<string, ReportNode>();
    for (const e of entries) {
      if (e.section.doc || e.section.kind === "details") continue;
      out.set(e.section.id, e.target ? buildTargetDraft(data, e.target, reportMeta) : buildSectionDraft(e.section.kind, data, settings));
    }
    return out;
  }, [entries, data, reportMeta, settings]);

  // Every section's stored page (or the draft it will get). Only the open page changes per keystroke; it is read live.
  const savedDocOf = useCallback(
    (s: ReportSection): ReportNode => (s.doc as ReportNode | null) ?? drafts.get(s.id) ?? EMPTY_DOC,
    [drafts],
  );
  const metaOf = useCallback(
    (s: ReportSection): SectionMeta => (liveMeta?.id === s.id ? liveMeta.meta : (s.meta as SectionMeta)),
    [liveMeta],
  );
  const openLiveDoc = openSection && live?.id === openSection.id ? live.doc : null;

  const appendixDocs = useCallback(
    (docOf: (s: ReportSection) => ReportNode) =>
      numberAppendices(
        entries.map((e) => ({ id: e.section.id, kind: e.section.kind, targetKey: e.section.targetKey, doc: e.section.kind === "details" ? null : docOf(e.section) })),
        (n) => appendixTitle(n, data),
      ),
    [entries, data],
  );
  const savedAppendix = useMemo(() => appendixDocs(savedDocOf), [appendixDocs, savedDocOf]);
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
  const openChecksLive = useMemo(
    () =>
      openTarget && openSection
        ? targetChecks({ data, target: openTarget, doc: openLiveDoc ?? savedDocOf(openSection), meta: reportMeta, appendixRefs: appendix, sectionId: openSection.id, coverage: openSectionMeta?.coverage })
        : null,
    [openTarget, openSection, data, openLiveDoc, savedDocOf, reportMeta, appendix, openSectionMeta],
  );
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
  const items = entries.map((e) => (e.target ? { ...e.item, state: stateOf(e.target, e.section.id) } : e.item));

  const figureOffset = useMemo(() => {
    let n = 0;
    for (const e of entries) {
      if (e.section.id === openSection?.id) break;
      if (e.section.kind !== "details") n += countFigures(savedDocOf(e.section), data);
    }
    return n;
  }, [entries, openSection?.id, savedDocOf, data]);

  const targetMeta = useMemo(() => {
    const out: Record<string, SectionMeta> = {};
    for (const e of entries) if (e.target) out[e.target.key] = metaOf(e.section);
    return out;
  }, [entries, metaOf]);

  // Autosave, flushed when the open section changes and on leaving.
  const [saveFailed, setSaveFailed] = useState(false);
  const saver = useSectionSaver(openSection?.id ?? "", { onError: () => setSaveFailed(true), onSaved: () => setSaveFailed(false) });
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

  // A section opened with no page yet gets its first draft, built and stored once (draftBuiltAt marks it).
  const building = useRef(new Set<string>());
  const [draftFailed, setDraftFailed] = useState<string | null>(null);
  useEffect(() => {
    const s = openSection;
    if (!s || s.doc || s.kind === "details" || draftFailed || building.current.has(s.id)) return;
    const doc = drafts.get(s.id);
    if (!doc) return;
    building.current.add(s.id);
    api
      .reportSectionUpsert(report.id, { kind: s.kind, targetKey: s.targetKey, position: s.position, doc, meta: s.meta, draftBuiltAt: Date.now() })
      .then((saved) => patchCachedSection(qc, s.id, saved))
      .catch((e: unknown) => {
        building.current.delete(s.id);
        reportError(e);
        setDraftFailed(e instanceof Error ? e.message : String(e));
      });
  }, [openSection, drafts, report.id, qc, draftFailed]);

  const saveReport = useCallback(
    (patch: ReportPatch) => {
      const key = reportKey(report.engagementId);
      const before = qc.getQueryData<Report>(key);
      const merged: ReportPatch = patch.meta && before ? { ...patch, meta: { ...before.meta, ...patch.meta } } : patch;
      if (before) qc.setQueryData<Report>(key, { ...before, ...merged } as Report);
      api
        .reportUpdate(report.id, merged)
        .then((saved) => qc.setQueryData(key, saved))
        .catch((e: unknown) => {
          reportError(e);
          void qc.invalidateQueries({ queryKey: key });
        });
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
  usePageShortcuts("Report", narrow ? NARROW_HINTS : HINTS);
  useKeydown((e) => {
    if (!narrow || !isFreeKey(e) || e.shiftKey || e.key.toLowerCase() !== "e") return;
    e.preventDefault();
    setRailOpen((o) => !o);
  });
  useKeydown((e) => {
    if (!isFreeKey(e) || (e.key !== "j" && e.key !== "k" && e.key !== "J" && e.key !== "K")) return;
    e.preventDefault();
    const from = navRef.current?.contains(document.activeElement) ? document.activeElement : null;
    focusOutlineRow(navRef.current, e.key.toLowerCase() === "j" ? 1 : -1, from);
  });
  useKeydown((e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.defaultPrevented || isDialogOpen()) return;
    const pane = { Digit1: "outline", Digit2: "page", Digit3: "rail" }[e.code];
    if (!pane) return;
    e.preventDefault();
    if (pane === "outline") focusOutlineRow(navRef.current, 0);
    else if (pane === "rail") {
      if (narrow) setRailOpen(true);
      else railRef.current?.focus();
    }
    else if (openEditor()) openEditor()!.focus();
    else pageRef.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
  });

  // A check takes the page to the block it concerns and selects it.
  const pickCheck = (check: Check) => {
    const editor = openEditor();
    if (!editor) return;
    const view = editor.view;
    let pos: number | null = null;
    let index = 0;
    view.state.doc.descendants((node, p) => {
      if (pos !== null) return false;
      const hit =
        check.anchor?.entryId !== undefined
          ? node.type.name === "evidence" && node.attrs.entryId === check.anchor.entryId
          : check.anchor?.nodeIndex !== undefined && index === check.anchor.nodeIndex;
      index++;
      if (hit) pos = p;
      return true;
    });
    if (pos !== null) {
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).scrollIntoView());
      (view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView?.({ block: "center" });
    }
    view.focus();
  };

  const openChecks = open?.target ? (checks.get(open.section.id) ?? []) : [];
  const machines = open?.target ? open.target.hostIds.map((id) => ({ hostId: id, name: data.hosts.find((h) => h.id === id)?.name ?? "Host" })) : [];
  const targetExtra = open?.target ? (
    <>
      <CheckList checks={openChecks} onPick={pickCheck} />
      <ExpectedFlags machines={machines} flagsOf={(id) => expectedFlags(open.target!, id, reportMeta)} onChange={setFlags} />
    </>
  ) : undefined;

  const contextValue = useMemo(
    (): ReportDataValue | null =>
      openSectionMeta ? { data, appendix, sectionMeta: openSectionMeta, onRemoveEvidence, reportMeta, targetMeta, figureOffset } : null,
    [data, appendix, openSectionMeta, onRemoveEvidence, reportMeta, targetMeta, figureOffset],
  );

  const notStarted = open?.target && stateOf(open.target, open.section.id) === "not-started";
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

  return (
    <section ref={sectionRef} aria-label="Report" className="@container/report grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <ReportStrip
        fileName={reportFileName(report.osid.trim())}
        osidValid={isValidOsid(report.osid.trim())}
        dueAt={reportDueAt(data.engagement, reportMeta)}
        ready={readyCount}
        targets={targetEntries.length}
        gaps={gaps}
        rail={narrow ? { open: railOpen, onToggle: () => setRailOpen((o) => !o) } : undefined}
      />
      {entries.length === 0 ? (
        ensureFailed ? (
          <ErrorState title="Couldn't set up the report" hint="Retry. If it keeps failing, lock and unlock Raven." onRetry={() => setEnsureFailed(null)} detail={ensureFailed} />
        ) : (
          <LoadingState label="the report" />
        )
      ) : (
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] @min-[1000px]/report:grid-cols-[272px_minmax(0,1fr)] @min-[1200px]/report:grid-cols-[272px_minmax(0,1fr)_320px]">
          <div className="hidden min-h-0 overflow-y-auto border-r border-line @min-[1000px]/report:block">
            <ReportOutline
              items={items}
              openId={open?.item.id ?? null}
              onOpen={setOpenId}
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
                value={open?.item.id}
                onValueChange={setOpenId}
              />
              {open?.target && (
                <Disclosure label="Checks" count={fails} open={checksOpen} onOpenChange={setChecksOpen}>
                  {targetExtra}
                </Disclosure>
              )}
            </div>
            {ensureFailed && (
              <WarnLine text={`Couldn't add the report's new sections: ${ensureFailed}`} onRetry={() => setEnsureFailed(null)} />
            )}
            {saveFailed && <p className="m-0 text-meta text-warn">Some typing isn't saved yet. Raven tries again with your next change; keep Raven open until this goes.</p>}
            {draftFailed && <WarnLine text={`Couldn't build this page's draft: ${draftFailed}`} onRetry={() => setDraftFailed(null)} />}
            {notStarted && open?.target && <p className="m-0 text-meta text-muted-2">Nothing logged on {open.item.label} yet. The page fills in as you work.</p>}
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
              openSection.doc ? (
                <ReportDataContext.Provider value={contextValue}>
                  <ReportEditor
                    key={openSection.id}
                    sectionId={openSection.id}
                    doc={openSection.doc as ReportNode}
                    onChange={onChange}
                    onReady={(editor) => {
                      editorRef.current = { id: openSection.id, editor };
                      setReadyEditor({ id: openSection.id, editor });
                    }}
                  />
                </ReportDataContext.Provider>
              ) : draftFailed ? null : (
                <LoadingState label="the draft" />
              )
            ) : null}
          </div>
          {narrow ? (
            <EvidenceDrawer open={railOpen} onClose={() => setRailOpen(false)}>
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
