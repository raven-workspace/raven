import type { LogEntry } from "../../../types/log";
import { bold, heading, para } from "../nodes";
import { PAGE_PHASES, PHASE_TITLE, placementPlan } from "../placement";
import { entryBlocks, finish, stepBlocks, testedRun } from "../plain";
import { blockSource, entriesNamedBy, testedListOf } from "./block";
import { parseSource, source } from "./source";
import type { Phase, ReportData, ReportNode, ReportTarget } from "../types";

/**
 * Placing entries on a page that already exists: which entries it holds, where a new step or screenshot goes, what
 * Add new evidence would bring back, and a draft without what the owner removed. Where an entry would go is the
 * placement plan's (`placement.ts`); whether it is there is always read off the page. The blocks themselves come from
 * the plain builder (`plain.ts`).
 */

/** The entry ids a page holds: those in `entry:<id>…` sources at any depth, every figure's `entryId`, and every id in
 *  an `also` attr (an entry a block already shows). */
export function entryIdsIn(doc: ReportNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: ReportNode) => {
    for (const id of entriesNamedBy(n)) ids.add(id);
    n.content?.forEach(walk);
  };
  walk(doc);
  return ids;
}

/* ------------------------------------------------------------------ Placing an entry */

/** Whether a level 1 or 2 heading ends the region before it. */
const breaksRegion = (n: ReportNode) => n.type === "heading" && ((n.attrs?.level as number | undefined) ?? 1) <= 2;
const isStepList = (n: ReportNode) => n.type === "list" && n.attrs?.kind === "ordered";
/** The entries a block names itself (its source, a figure's entry, its `also`), not its children's. */
const ownIds = (n: ReportNode) => new Set(entriesNamedBy(n));

/** The machine whose heading a block is (`facts`), or null. */
const factsOf = (n: ReportNode) => {
  const s = blockSource(n);
  return s?.kind === "facts" ? s.hostId : null;
};
/** The top-level index where a machine's part of the page ends: its next machine's heading, else the end. */
function hostEnd(content: ReportNode[], hostId: string): number {
  const facts = content.findIndex((n) => factsOf(n) === hostId);
  const next = facts === -1 ? -1 : content.findIndex((n, i) => i > facts && factsOf(n) !== null);
  return next === -1 ? content.length : next;
}
/** The end of the region a heading at `head` opens: the next level 1 or 2 heading, else the end. */
function regionEnd(content: ReportNode[], head: number): number {
  let end = head + 1;
  while (end < content.length && !breaksRegion(content[end])) end++;
  return end;
}

/**
 * Where a new step for `entry` goes on a page with no cursor: `index` is the top-level index at the end of the region
 * of the last heading whose source is `phase:<hostId>:<phase>` (or `…:<findingId>`), the region running to the next
 * level 1 or 2 heading or the end. `before` lists the blocks to insert first: the phase's heading when it has none
 * (before the host's first later-phase heading, else its Additional findings or Also tested heading, else the next
 * machine's heading, else at the end), and "Steps to reproduce:" when the region holds no step yet. The phase is the
 * placement plan's (`phaseOf`); `enum` is the Service enumeration region. A phase with no step heading of its own goes at the end of
 * the machine's part of the page.
 */
export function phaseInsertAt(doc: ReportNode, data: ReportData, target: ReportTarget, entry: LogEntry): { index: number; before: ReportNode[] } {
  const { hostId, phase } = placementPlan(data, target).phaseOf(entry);
  const content = doc.content ?? [];
  const ofPhase = (n: ReportNode, p: Phase) => {
    const s = blockSource(n);
    return n.type === "heading" && s?.kind === "phase" && s.hostId === hostId && s.phase === p;
  };
  const isStepsLabel = (n: ReportNode) => {
    const s = blockSource(n);
    return s?.kind === "phase-steps" && s.hostId === hostId;
  };
  const stepsLabel = para([bold("Steps to reproduce:")], source.phaseSteps(hostId));
  if (!PAGE_PHASES.includes(phase)) return { index: hostEnd(content, hostId), before: [] };

  const head = content.reduce((found, n, i) => (ofPhase(n, phase) ? i : found), -1);
  if (head !== -1) {
    const end = regionEnd(content, head);
    const labelled = content.slice(head + 1, end).some((n) => isStepList(n) || isStepsLabel(n));
    return { index: end, before: finish(labelled ? [] : [stepsLabel]) };
  }

  const later = PAGE_PHASES.slice(PAGE_PHASES.indexOf(phase) + 1);
  let at = content.findIndex((n) => later.some((p) => ofPhase(n, p)));
  if (at === -1) at = content.findIndex((n) => ofPhase(n, "additional") || ofPhase(n, "tested"));
  if (at === -1) at = hostEnd(content, hostId);
  const title = PHASE_TITLE[phase]!;
  return { index: at, before: finish([heading(2, title, source.phase(hostId, phase)), stepsLabel]) };
}

/**
 * Where a screenshot that illustrates a step, or goes with its flag, goes on a page with no cursor: the plan's step
 * that holds it (with another entry leading it) is matched to the page's numbered step holding any of that step's
 * other entries, and the screenshot's own blocks go at its end. A finding's screenshot that goes with the finding
 * itself goes at the end of its Additional findings bullet. Null when the screenshot leads a step of its own, or the
 * page has no such step or bullet: it then goes as a step of its own.
 */
export function companionStepAt(doc: ReportNode, data: ReportData, target: ReportTarget, entry: LogEntry): { index: number; blocks: ReportNode[] } | null {
  if (entry.content.kind !== "screenshot") return null;
  const placed = placementPlan(data, target).at(entry.id);
  if (placed?.role === "with-finding" && placed.finding) return findingBulletAt(doc, data, entry, placed.finding.id);
  const step = placed?.step;
  if (!step || step.lead.id === entry.id) return null;
  const others = step.entries.map((e) => e.id).filter((id) => id !== entry.id);
  const content = doc.content ?? [];
  const index = content.findIndex((n) => isStepList(n) && others.some((id) => entryIdsIn(n).has(id)));
  if (index === -1) return null;
  return { index, blocks: stepBlocks(data, step).filter((b) => ownIds(b).has(entry.id)) };
}

/** A finding's screenshot that goes with the finding itself: at the end of the page's Additional findings bullet for
 *  that finding (`finding:<id>`), as a figure. Null when the page has no such bullet. */
function findingBulletAt(doc: ReportNode, data: ReportData, entry: LogEntry, findingId: string): { index: number; blocks: ReportNode[] } | null {
  const index = (doc.content ?? []).findIndex((n) => {
    const s = blockSource(n);
    return n.type === "list" && s?.kind === "finding" && s.findingId === findingId && s.part === null;
  });
  if (index === -1) return null;
  return { index, blocks: entryBlocks(data, entry).filter((b) => b.type === "figure") };
}

/**
 * Add new evidence's entries: those the plan places that the page holds no block of and the owner hasn't removed, in
 * time order.
 */
export function missingEntries(doc: ReportNode, data: ReportData, target: ReportTarget, removed: readonly string[]): LogEntry[] {
  const { placed } = placementPlan(data, target);
  const onPage = entryIdsIn(doc);
  return data.log
    .filter((e) => placed.has(e.id) && !onPage.has(e.id) && !removed.includes(e.id))
    .sort((a, b) => a.at - b.at || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** What `removedEntryIds` records when the owner deletes a machine's whole Also tested list. */
export const testedKey = (hostId: string) => source.tested(hostId);
/** The machine a `removedEntryIds` key names the Also tested list of, or null for an entry id. */
const testedKeyHost = (key: string) => {
  const s = parseSource(key);
  return s?.kind === "tested" ? s.hostId : null;
};

/** What a page places that its owner can remove and Add new evidence would bring back: its entries (`entryIdsIn`)
 *  and each machine's Also tested list (`testedKey`, from a `tested:<hostId>` block). */
export function placedIdsIn(doc: ReportNode): Set<string> {
  const ids = entryIdsIn(doc);
  const walk = (n: ReportNode) => {
    const hostId = testedListOf(n);
    if (hostId !== null) ids.add(testedKey(hostId));
    n.content?.forEach(walk);
  };
  walk(doc);
  return ids;
}

/**
 * A draft without what the owner took off the page (`removedEntryIds`), so a rebuild never puts it back: every block of
 * a removed entry (its source's, a figure's), a numbered step left with nothing in it, and for a `tested:<hostId>` key
 * that machine's Also tested heading and bullets. A block that shows a removed entry only in its `also` stays (it is
 * another entry's), the removed id taken out of its `also`, so the page doesn't count that entry as placed. Then what
 * that leaves bare goes too (`withoutBare`): a "Steps to reproduce:" label with no step after it in its region, and a
 * phase heading with nothing under it.
 */
export function withoutRemoved(doc: ReportNode, removed: readonly string[]): ReportNode {
  if (removed.length === 0) return doc;
  const gone = new Set(removed);
  const tested = new Set(removed.flatMap((k) => testedKeyHost(k) ?? []));
  const dropped = (n: ReportNode) => {
    const s = blockSource(n);
    const id = s?.kind === "entry" ? s.entryId : n.type === "figure" && typeof n.attrs?.entryId === "string" ? n.attrs.entryId : null;
    if (id !== null && gone.has(id)) return true;
    if (s?.kind === "tested") return tested.has(s.hostId);
    return s?.kind === "phase" && s.phase === "tested" && s.findingId === null && tested.has(s.hostId);
  };
  const clean = (n: ReportNode): ReportNode | null => {
    if (dropped(n)) return null;
    let out = n;
    const also = n.attrs?.also;
    if (Array.isArray(also) && also.some((id) => gone.has(id))) {
      const kept = also.filter((id) => !gone.has(id));
      const attrs = Object.fromEntries(Object.entries(n.attrs!).filter(([k]) => k !== "also"));
      out = { ...n, attrs: kept.length > 0 ? { ...attrs, also: kept } : attrs };
    }
    if (!n.content || n.type === "text") return out;
    const content = n.content.map(clean).filter((c): c is ReportNode => c !== null);
    if (content.length === 0 && n.content.length > 0 && n.type === "list") return null;
    return { ...out, content };
  };
  const out = clean(doc) ?? { ...doc, content: [] };
  return { ...out, content: withoutBare(out.content ?? []) };
}

/** Top-level blocks without a "Steps to reproduce:" label (`phase-steps:*`) that has no numbered step after it before
 *  the next level 1 or 2 heading, and without a phase heading (`phase:*`) whose next block is a heading of its level
 *  or above, or the end. Read from the end, so a heading left bare by a sub-heading going goes too. */
function withoutBare(content: ReportNode[]): ReportNode[] {
  const level = (n: ReportNode) => (n.attrs?.level as number | undefined) ?? 1;
  const out: ReportNode[] = [];
  for (let i = content.length - 1; i >= 0; i--) {
    const n = content[i];
    const s = blockSource(n);
    if (s?.kind === "phase-steps") {
      const end = out.findIndex(breaksRegion);
      if (!(end === -1 ? out : out.slice(0, end)).some(isStepList)) continue;
    }
    const next = out[0];
    if (n.type === "heading" && s?.kind === "phase" && (!next || (next.type === "heading" && level(next) <= level(n)))) continue;
    out.unshift(n);
  }
  return out;
}

/**
 * Whether a screenshot illustrates another entry's step in the plan, or goes with its flag (it is not that step's
 * lead), or goes with its finding itself, so on a page with no cursor it joins the step holding that entry, or the
 * finding's bullet (`companionStepAt`).
 */
export function joinsAStep(data: ReportData, target: ReportTarget, entry: LogEntry): boolean {
  if (entry.content.kind !== "screenshot") return false;
  const placed = placementPlan(data, target).at(entry.id);
  if (placed?.role === "with-finding") return true;
  return placed?.step != null && placed.step.lead.id !== entry.id;
}

/**
 * A machine's Also tested run as the draft writes it (`testedRun`), for Add new evidence, when the page holds no
 * `tested:<hostId>` block and the draft has some: the bullets at the end of the page's Also tested region, or the
 * heading and the bullets at the end of the machine's part of the page. Null otherwise, and when the owner deleted it
 * (its `testedKey` is in `removed`).
 */
export function missingTested(doc: ReportNode, data: ReportData, hostId: string, removed: readonly string[] = []): { index: number; blocks: ReportNode[] } | null {
  // The owner deleted the list: it stays deleted.
  if (removed.includes(testedKey(hostId))) return null;
  const content = doc.content ?? [];
  const isBullet = (n: ReportNode) => testedListOf(n) === hostId;
  const has = (n: ReportNode): boolean => isBullet(n) || (n.content ?? []).some(has);
  if (content.some(has)) return null;
  const run = testedRun(data, hostId);
  const bullets = run.filter(isBullet);
  if (bullets.length === 0) return null;
  const head = content.findIndex((n) => {
    const s = blockSource(n);
    return n.type === "heading" && s?.kind === "phase" && s.hostId === hostId && s.phase === "tested" && s.findingId === null;
  });
  if (head !== -1) return { index: regionEnd(content, head), blocks: bullets };
  return { index: hostEnd(content, hostId), blocks: run };
}
