import type { QueryClient } from "@tanstack/react-query";
import type { Editor } from "prosekit/core";
import { createContext, useContext } from "react";
import { Fragment, type Node as PMNode } from "prosekit/pm/model";
import { closeHistory } from "prosekit/pm/history";
import { NodeSelection } from "prosekit/pm/state";
import { StepMap } from "prosekit/pm/transform";
import {
  blockHash,
  companionStepAt,
  draftedEntryBlocks,
  draftOf,
  phaseInsertAt,
  refreshBlocks,
  refreshFamily,
  stamp,
  type Drafted,
  type ReportData,
  type ReportMeta,
  type ReportNode,
  type ReportTarget,
} from "../../../engines/report";
import { api } from "../../../lib/api";
import type { LogEntry } from "../../../types/log";
import { readImage, releaseImage } from "../../capture/imagePaste";
import { logKey } from "../../log/queries";

/** What the page's menus and toolbar ask the page to do beyond ProseKit's own commands. */
export interface PageActions {
  /** Saves an image as a screenshot entry of this target and puts it on the page at `pos` (else after the cursor's block). */
  addImage(file: File, pos?: number): void;
  /** Opens the file picker for an image, then `addImage`. */
  pickImage(): void;
}

export const PageActionsContext = createContext<PageActions>({ addImage: () => {}, pickImage: () => {} });
export const usePageActions = () => useContext(PageActionsContext);

/** The top-level block a position is in (or just before), by index. */
const topIndexAt = (doc: Editor["state"]["doc"], pos: number) => doc.resolve(Math.max(0, Math.min(pos, doc.content.size))).index(0);

/** The machine a top-level block names: a machine heading (`facts:<hostId>`) or a phase heading (`phase:<hostId>:…`). */
function hostOfBlock(node: PMNode): string | null {
  const source = typeof node.attrs.source === "string" ? node.attrs.source : "";
  return /^(?:facts|phase):([^:]+)/.exec(source)?.[1] ?? null;
}

/**
 * The machine a position on the page belongs to: on an AD set's page, the one whose section it sits in (the nearest
 * machine or phase heading above it), else the target's first machine. None on a page without a target.
 */
export function hostAtPos(editor: Editor, pos: number, target: ReportTarget | undefined): string | null {
  if (!target || target.hostIds.length === 0) return null;
  const doc = editor.state.doc;
  const upTo = topIndexAt(doc, pos);
  let found: string | null = null;
  doc.forEach((node, _offset, i) => {
    if (i > upTo) return;
    const hostId = hostOfBlock(node);
    if (hostId && target.hostIds.includes(hostId)) found = hostId;
  });
  return found ?? target.hostIds[0];
}

const fileNameOf = (file: File) => file.name || `screenshot.${file.type.split("/")[1] ?? "png"}`;

/**
 * Saves an image as a screenshot log entry for `hostIds` (the attachment storage the capture panel uses), and adds it
 * to the cached log at once so the page can render it before the refetch.
 */
export async function saveScreenshot(qc: QueryClient, engagementId: string, hostIds: string[], file: File): Promise<LogEntry> {
  const image = await readImage(file);
  releaseImage(image);
  const entry = await api.logCreate(engagementId, {
    title: "Screenshot",
    ranOn: null,
    hostIds,
    observations: null,
    returnedNothing: false,
    private: false,
    content: { kind: "screenshot", attachmentId: "", caption: "", fileName: fileNameOf(file) },
    attachment: { mime: image.mime, dataBase64: image.dataBase64 },
  });
  qc.setQueryData<LogEntry[]>(logKey(engagementId), (list) => (list ? [...list, entry] : list));
  void qc.invalidateQueries({ queryKey: logKey(engagementId) });
  return entry;
}

/** Where `block` (a node the block handle named at `pos`) stands now: there if it still is, else wherever it moved. */
function currentPos(editor: Editor, block: { node: PMNode; pos: number }): number | null {
  const doc = editor.state.doc;
  if (doc.nodeAt(block.pos) === block.node) return block.pos;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node === block.node) found = pos;
    return true;
  });
  return found;
}

/** Deletes a block. The evidence in it (a step's, a list's too) is remembered as removed by the page's removal
 *  tracking (`removedByTransaction`), as ⌫ is. */
export function deleteBlockAt(editor: Editor, block: { node: PMNode; pos: number }): boolean {
  return editor.exec((state, dispatch) => {
    const pos = currentPos(editor, block);
    if (pos === null) return false;
    dispatch?.(state.tr.delete(pos, pos + block.node.nodeSize));
    return true;
  });
}

/** Marks a transaction the page makes itself (Add new evidence's Undo or a Refresh): what it
 *  takes off the page is not the owner's removal. */
export const PROGRAMMATIC = "raven:programmatic";

/** Where blocks go beside a position: `from`..`to` in a parent that takes them (equal when inserting). */
interface Spot {
  from: number;
  to: number;
}

/**
 * Where blocks go after the block at `pos` (the cursor's textblock, or a selected block): right after it, in its
 * parent. An empty paragraph without a hint is replaced; a hint paragraph never is. A cell of a table counts as the
 * table: the blocks go after the table, never into a cell. A parent that can't take them passes them up a level.
 */
function spotAfter(doc: PMNode, pos: number, selected: PMNode | null, made: PMNode[]): Spot {
  const frag = Fragment.from(made);
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  let depth: number;
  if (selected) depth = $pos.depth + 1;
  else if ($pos.parent.isTextblock) depth = $pos.depth;
  else {
    // Between blocks: insert right there, when the parent takes them.
    if ($pos.parent.canReplace($pos.index(), $pos.index(), frag)) return { from: $pos.pos, to: $pos.pos };
    depth = $pos.depth;
  }
  for (let d = 1; d <= Math.min(depth, $pos.depth); d++) {
    if ($pos.node(d).type.name === "table") {
      depth = d;
      break;
    }
  }
  const blockAt = (d: number) => (d === $pos.depth + 1 ? selected! : $pos.node(d));
  const before = (d: number) => (d === $pos.depth + 1 ? $pos.pos : $pos.before(d));
  const index = (d: number) => $pos.index(d - 1);
  const block = blockAt(depth);
  const parent = $pos.node(depth - 1);
  const empty = block.type.name === "paragraph" && block.content.size === 0 && !block.attrs.hint;
  if (empty && parent.canReplace(index(depth), index(depth) + 1, frag)) return { from: before(depth), to: before(depth) + block.nodeSize };
  for (let d = depth; d >= 1; d--) {
    const after = before(d) + blockAt(d).nodeSize;
    if ($pos.node(d - 1).canReplace(index(d) + 1, index(d) + 1, frag)) return { from: after, to: after };
  }
  return { from: doc.content.size, to: doc.content.size };
}

/** Ends the page's current undo group: what the owner types next is an undo step of its own, never merged with the
 *  page's own change just before it. */
function endUndoGroup(editor: Editor) {
  editor.exec((state, dispatch) => {
    dispatch?.(closeHistory(state.tr));
    return true;
  });
}

/** The ranges inserted on a page while `collectInserted` runs, kept current as later inserts shift or grow them. */
const tracked = new WeakMap<Editor, { from: number; to: number }[]>();

/** Records an insert of `size` at `from` (replacing up to `to`): earlier ranges map through it (an insert inside one
 *  grows it), then each inserted block's range is added. */
function track(editor: Editor, from: number, to: number, made: PMNode[]) {
  const ranges = tracked.get(editor);
  if (!ranges) return;
  const size = made.reduce((n, b) => n + b.nodeSize, 0);
  const map = new StepMap([from, to - from, size]);
  for (const r of ranges) {
    r.from = map.map(r.from, 1);
    r.to = map.map(r.to, -1);
  }
  let at = from;
  for (const b of made) {
    ranges.push({ from: at, to: at + b.nodeSize });
    at += b.nodeSize;
  }
}

/**
 * Runs inserts (`insertEntry`, `insertBlocksAt`) and returns exactly what they added, as it stands on the page after
 * the last: a block added into a block added earlier (a screenshot joining a step added in the same run) counts as
 * part of that one. For Add new evidence's Undo (`removeExact`).
 */
export function collectInserted(editor: Editor, run: () => void): PMNode[] {
  const ranges: { from: number; to: number }[] = [];
  tracked.set(editor, ranges);
  try {
    run();
  } finally {
    tracked.delete(editor);
  }
  const doc = editor.state.doc;
  const outer = ranges.filter((r, i) => !ranges.some((o, j) => j !== i && o.from <= r.from && r.to <= o.to && (o.from < r.from || r.to < o.to)));
  return outer.map((r) => doc.nodeAt(r.from)).filter((n, i): n is PMNode => n !== null && n.nodeSize === outer[i].to - outer[i].from);
}

/** Inserts `made` at `spot` in one transaction, an undo step of its own (never merged with typing before or after
 *  it); returns the nodes as they stand on the page after it. */
function insertAtSpot(editor: Editor, spot: (doc: PMNode) => Spot, made: PMNode[]): PMNode[] {
  let at: number | null = null;
  editor.exec((state, dispatch) => {
    const { from, to } = spot(state.doc);
    at = from;
    if (dispatch) {
      dispatch(closeHistory(state.tr.replaceWith(from, to, made)).scrollIntoView());
      track(editor, from, to, made);
    }
    return true;
  });
  if (at === null) return [];
  endUndoGroup(editor);
  const $at = editor.state.doc.resolve(at);
  const out: PMNode[] = [];
  for (let i = $at.index(); i < Math.min($at.parent.childCount, $at.index() + made.length); i++) out.push($at.parent.child(i));
  return out;
}

/** The top-level position before the block at `index` (the end of the page past the last block). */
const topPos = (doc: PMNode, index: number) => {
  let pos = 0;
  for (let i = 0; i < Math.min(index, doc.childCount); i++) pos += doc.child(i).nodeSize;
  return pos;
};

/** Puts blocks at a top-level index, one undo step; returns them as they stand on the page. */
export function insertBlocksAt(editor: Editor, index: number, blocks: ReportNode[]): PMNode[] {
  const made = blocks.map((n) => editor.state.schema.nodeFromJSON(n));
  return insertAtSpot(editor, (doc) => ({ from: topPos(doc, index), to: topPos(doc, index) }), made);
}

/** Whether the cursor is in a heading, or a heading is the selected block: + add then places by phase. */
function cursorInHeading(editor: Editor): boolean {
  const sel = editor.state.selection;
  const node = sel instanceof NodeSelection ? sel.node : sel.$from.parent;
  return node.type.name === "heading";
}

/**
 * Puts a log entry on a plain page, as one undoable step, and returns the nodes it inserted. Its blocks are the
 * draft's (`draftedEntryBlocks`): an entry one of them already shows (a flag its output prints) is placed with it.
 * With the owner's cursor on the page (`atCursor`, `hasPageCursor`) outside a heading, they go right after the
 * cursor's block, inside its list or step: an empty paragraph without a hint is replaced, a hint paragraph never is.
 * Without one, a screenshot that came along with a step on the page joins that step (`companionStepAt`); anything else
 * goes as a new numbered step at the end of the entry's phase (`phaseInsertAt`), after its heading and "Steps to
 * reproduce:" when the page has none yet. The target's draft is built once per call, or once per run by a caller
 * placing many (`drafted`, from `draftOf`).
 */
export function insertEntry(
  editor: Editor,
  data: ReportData,
  target: ReportTarget,
  entry: LogEntry,
  atCursor: boolean,
  meta: ReportMeta = {},
  drafted: Drafted = draftOf(data, target, meta),
): PMNode[] {
  const schema = editor.state.schema;
  if (atCursor && !cursorInHeading(editor)) {
    const made = draftedEntryBlocks(data, target, meta, entry, drafted).map((n) => schema.nodeFromJSON(n));
    return insertAtSpot(
      editor,
      (doc) => {
        const sel = editor.state.selection;
        return spotAfter(doc, sel.from, sel instanceof NodeSelection && sel.node.isBlock ? sel.node : null, made);
      },
      made,
    );
  }
  const doc = editor.state.doc.toJSON() as ReportNode;
  const joins = companionStepAt(doc, data, target, meta, entry, drafted);
  if (joins) {
    const made = joins.blocks.map((n) => schema.nodeFromJSON(n));
    return insertAtSpot(
      editor,
      (d) => {
        const end = topPos(d, joins.index) + d.child(joins.index).nodeSize - 1;
        return { from: end, to: end };
      },
      made,
    );
  }
  const { index, before } = phaseInsertAt(doc, data, target, entry);
  return insertBlocksAt(editor, index, [...before, { type: "list", attrs: { kind: "ordered" }, content: draftedEntryBlocks(data, target, meta, entry, drafted) }]);
}

/**
 * Puts a pasted or dropped screenshot on the page as a figure with an empty caption (the page's to write), after the
 * block at `pos`, in its parent: an empty paragraph without a hint is replaced. One undoable step.
 */
export function insertFigure(editor: Editor, entry: LogEntry, pos: number): PMNode[] {
  if (entry.content.kind !== "screenshot") return [];
  const [figure] = stamp([{ type: "figure", attrs: { attachmentId: entry.content.attachmentId, entryId: entry.id, source: `entry:${entry.id}` } }]);
  const made = [editor.state.schema.nodeFromJSON(figure)];
  return insertAtSpot(editor, (doc) => spotAfter(doc, Math.min(pos, doc.content.size), null, made), made);
}

/** A run of sibling blocks that share one source (an entry's title and observations count as one, `refreshFamily`):
 *  Refresh replaces it as a whole. */
export interface SourceRun {
  from: number;
  to: number;
  nodes: PMNode[];
  source: string;
}

/** The contiguous siblings around the block at `pos` whose source is of its family; null when it has none. */
export function sourceRun(doc: PMNode, pos: number): SourceRun | null {
  const node = doc.nodeAt(pos);
  const source = node?.attrs.source;
  if (!node || typeof source !== "string" || source === "") return null;
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const family = refreshFamily(source);
  const same = (i: number) => {
    const s = parent.child(i).attrs.source;
    return typeof s === "string" && s !== "" && refreshFamily(s) === family;
  };
  let first = index;
  while (first > 0 && same(first - 1)) first--;
  let last = index;
  while (last < parent.childCount - 1 && same(last + 1)) last++;
  let from = $pos.start();
  for (let i = 0; i < first; i++) from += parent.child(i).nodeSize;
  const nodes: PMNode[] = [];
  for (let i = first; i <= last; i++) nodes.push(parent.child(i));
  return { from, to: from + nodes.reduce((n, b) => n + b.nodeSize, 0), nodes, source };
}

/** A run as it stands now: in place when its blocks still are, else the first run on the page of its source's family
 *  (it moved); null when the page no longer holds it. */
export function currentRun(doc: PMNode, run: SourceRun): SourceRun | null {
  let pos = run.from;
  const inPlace = run.nodes.every((n) => {
    const here = pos <= doc.content.size ? doc.nodeAt(pos) : null;
    pos += n.nodeSize;
    return here === n;
  });
  if (inPlace) return run;
  const family = refreshFamily(run.source);
  let found: number | null = null;
  doc.descendants((node, at) => {
    if (found === null && typeof node.attrs.source === "string" && node.attrs.source !== "" && refreshFamily(node.attrs.source) === family) found = at;
    return found === null;
  });
  return found === null ? null : sourceRun(doc, found);
}

/** An empty paragraph showing a hint: it holds no words of anyone's. */
const isEmptyHint = (n: PMNode) => n.type.name === "paragraph" && n.content.size === 0 && typeof n.attrs.hint === "string" && n.attrs.hint !== "";

/** Whether the owner changed any of these blocks since they were generated: its hash differs from its `gen`, or it has
 *  none (a flattened block, whose words may be the owner's). An empty hint paragraph is never edited. */
export function isEdited(nodes: PMNode[]): boolean {
  return nodes.some((n) => !isEmptyHint(n) && (typeof n.attrs.gen !== "string" || n.attrs.gen === "" || blockHash(n.toJSON() as ReportNode) !== n.attrs.gen));
}

/** Replaces a run with its source's blocks as the draft writes them now (`refreshBlocks`), in one undo step of its own
 *  (⌘Z brings the owner's words back, never merged with their typing). False, the page untouched, when the source
 *  offers no Refresh (unknown, private or deleted, or regenerating nothing). */
export function refreshRun(editor: Editor, run: SourceRun, data: ReportData, target: ReportTarget | null, meta: ReportMeta): boolean {
  const blocks = refreshBlocks(run.source, data, target, meta);
  if (!blocks) return false;
  const done = editor.exec((state, dispatch) => {
    const made = blocks.map((n) => state.schema.nodeFromJSON(n));
    dispatch?.(closeHistory(state.tr.replaceWith(run.from, run.to, made)).setMeta(PROGRAMMATIC, true));
    return true;
  });
  if (done) endUndoGroup(editor);
  return done;
}

/** The block menu's Refresh item for a source: the log's, a finding's (its file's too), else Raven's own. */
export function refreshLabel(source: string): "Refresh from log" | "Refresh from finding" | "Refresh from Raven" {
  if (source.startsWith("entry:")) return "Refresh from log";
  if (source.startsWith("finding:") || source.startsWith("file:")) return "Refresh from finding";
  return "Refresh from Raven";
}
