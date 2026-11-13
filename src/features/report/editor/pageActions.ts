import type { QueryClient } from "@tanstack/react-query";
import type { Editor } from "prosekit/core";
import { createContext, useContext } from "react";
import { Fragment, type Node as PMNode } from "prosekit/pm/model";
import { closeHistory } from "prosekit/pm/history";
import { NodeSelection } from "prosekit/pm/state";
import {
  blockHash,
  entryBlocks,
  phaseInsertAt,
  sourceBlocks,
  stamp,
  type DocPath,
  type ReportData,
  type ReportMeta,
  type ReportNode,
  type ReportTarget,
} from "../../../engines/report";
import { api } from "../../../lib/api";
import type { LogEntry } from "../../../types/log";
import { readImage, releaseImage } from "../../capture/imagePaste";

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
  qc.setQueryData<LogEntry[]>(["log", engagementId], (list) => (list ? [...list, entry] : list));
  void qc.invalidateQueries({ queryKey: ["log", engagementId] });
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

/** The position a `DocPath` names (top-level index, then child indices; the last is where nodes go in their parent),
 *  or null when the page has no such place. */
export function pathPos(doc: PMNode, path: DocPath): number | null {
  let at = 0;
  let parent = doc;
  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth];
    if (index > parent.childCount) return null;
    for (let i = 0; i < index; i++) at += parent.child(i).nodeSize;
    if (depth < path.length - 1) {
      if (index >= parent.childCount) return null;
      parent = parent.child(index);
      at += 1;
    }
  }
  return at;
}


/** Marks a transaction the page makes itself (Add new evidence's Undo, a Refresh, notes turned into text): what it
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

/** Inserts `made` at `spot` in one transaction, an undo step of its own (never merged with typing just before it);
 *  returns the nodes as they stand on the page after it. */
function insertAtSpot(editor: Editor, spot: (doc: PMNode) => Spot, made: PMNode[]): PMNode[] {
  let at: number | null = null;
  editor.exec((state, dispatch) => {
    const { from, to } = spot(state.doc);
    at = from;
    dispatch?.(closeHistory(state.tr.replaceWith(from, to, made)).scrollIntoView());
    return true;
  });
  if (at === null) return [];
  const $at = editor.state.doc.resolve(at);
  const out: PMNode[] = [];
  for (let i = $at.index(); i < Math.min($at.parent.childCount, $at.index() + made.length); i++) out.push($at.parent.child(i));
  return out;
}

/**
 * Puts a log entry on a plain page, as one undoable step, and returns the top-level nodes it inserted. With the owner's
 * cursor on the page (`atCursor`, `hasPageCursor`), the entry's blocks (`entryBlocks`) go right after the cursor's
 * block, inside its list or step: an empty paragraph without a hint is replaced, a hint paragraph never is. Without
 * one, they go as a new numbered step at the end of the entry's phase (`phaseInsertAt`), after its heading and "Steps
 * to reproduce:" when the page has none yet.
 */
export function insertEntry(editor: Editor, data: ReportData, target: ReportTarget, entry: LogEntry, atCursor: boolean): PMNode[] {
  const schema = editor.state.schema;
  const blocks = entryBlocks(data, entry);
  if (atCursor) {
    const made = blocks.map((n) => schema.nodeFromJSON(n));
    return insertAtSpot(
      editor,
      (doc) => {
        const sel = editor.state.selection;
        return spotAfter(doc, sel.from, sel instanceof NodeSelection && sel.node.isBlock ? sel.node : null, made);
      },
      made,
    );
  }
  const { index, before } = phaseInsertAt(editor.state.doc.toJSON() as ReportNode, data, target, entry);
  const made = [...before, { type: "list", attrs: { kind: "ordered" }, content: blocks }].map((n) => schema.nodeFromJSON(n));
  return insertAtSpot(
    editor,
    (doc) => {
      let pos = 0;
      for (let i = 0; i < Math.min(index, doc.childCount); i++) pos += doc.child(i).nodeSize;
      return { from: pos, to: pos };
    },
    made,
  );
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

/** A run of sibling blocks that share one source: Refresh replaces it as a whole. */
export interface SourceRun {
  from: number;
  to: number;
  nodes: PMNode[];
  source: string;
}

/** The contiguous siblings around the block at `pos` that share its `source`; null when it has none. */
export function sourceRun(doc: PMNode, pos: number): SourceRun | null {
  const node = doc.nodeAt(pos);
  const source = node?.attrs.source;
  if (!node || typeof source !== "string" || source === "") return null;
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const same = (i: number) => parent.child(i).attrs.source === source;
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

/** Whether the owner changed any of these blocks since they were generated: its hash differs from its `gen`, or it has
 *  none (a flattened block, whose words may be the owner's). */
export function isEdited(nodes: PMNode[]): boolean {
  return nodes.some((n) => typeof n.attrs.gen !== "string" || n.attrs.gen === "" || blockHash(n.toJSON() as ReportNode) !== n.attrs.gen);
}

/** Replaces a run with its source's blocks as the draft writes them now (`sourceBlocks`), in one undo step of its own
 *  (⌘Z brings the owner's words back, never merged with their typing). False
 *  when the source offers no Refresh (unknown, private or deleted). */
export function refreshRun(editor: Editor, run: SourceRun, data: ReportData, target: ReportTarget | null, meta: ReportMeta): boolean {
  const blocks = sourceBlocks(run.source, data, target, meta);
  if (!blocks) return false;
  return editor.exec((state, dispatch) => {
    const made = blocks.map((n) => state.schema.nodeFromJSON(n));
    dispatch?.(closeHistory(state.tr.replaceWith(run.from, run.to, made)).setMeta(PROGRAMMATIC, true));
    return true;
  });
}

/** The block menu's Refresh item for a source: the log's, a finding's (its file's too), else Raven's own. */
export function refreshLabel(source: string): "Refresh from log" | "Refresh from finding" | "Refresh from Raven" {
  if (source.startsWith("entry:")) return "Refresh from log";
  if (source.startsWith("finding:") || source.startsWith("file:")) return "Refresh from finding";
  return "Refresh from Raven";
}
