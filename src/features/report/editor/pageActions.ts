import type { QueryClient } from "@tanstack/react-query";
import type { Editor } from "prosekit/core";
import { createContext, useContext } from "react";
import type { Node as PMNode } from "prosekit/pm/model";
import type { Command, EditorState } from "prosekit/pm/state";
import {
  endOfPhase,
  evidenceBlocks,
  evidenceNodes,
  MAX_INLINE_LINES,
  type AppendixPlacement,
  type DocPath,
  type ReportData,
  type ReportNode,
  type ReportTarget,
} from "../../../engines/report";
import { api } from "../../../lib/api";
import type { LogEntry } from "../../../types/log";
import { readImage, releaseImage } from "../../capture/imagePaste";
import { insertIntoCurrentStep } from "./commands";

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

/**
 * The machine a position on the page belongs to: on an AD set's page, the one whose section it sits in (the nearest
 * machine heading or phase above it), else the target's first machine. None on a page without a target.
 */
export function hostAtPos(editor: Editor, pos: number, target: ReportTarget | undefined): string | null {
  if (!target || target.hostIds.length === 0) return null;
  const doc = editor.state.doc;
  const upTo = topIndexAt(doc, pos);
  let found: string | null = null;
  doc.forEach((node, _offset, i) => {
    if (i > upTo) return;
    const hostId = node.attrs.hostId as unknown;
    if ((node.type.name === "phase" || (node.type.name === "generated" && node.attrs.kind === "facts")) && typeof hostId === "string" && target.hostIds.includes(hostId))
      found = hostId;
  });
  return found ?? target.hostIds[0];
}

/**
 * Puts a log entry on the page at `pos` (the cursor when absent), never splitting a block: in place of the empty
 * paragraph the cursor is in, else after the cursor's top-level block. After a block the owner writes in (a slot or a
 * paragraph) the entry takes no slot of its own: that block is its explanation. `evidenceAttrs` go on its evidence
 * blocks (a pasted screenshot's empty caption).
 */
export function placeEntry(editor: Editor, entry: LogEntry, pos?: number, evidenceAttrs?: Record<string, unknown>): boolean {
  return editor.exec((state, dispatch) => {
    const at = pos ?? state.selection.from;
    const $pos = state.doc.resolve(Math.max(0, Math.min(at, state.doc.content.size)));
    if ($pos.depth === 0) {
      dispatch?.(state.tr.insert($pos.pos, evidenceNodes(entry).map((n) => state.schema.nodeFromJSON(n))).scrollIntoView());
      return true;
    }
    const top = $pos.node(1);
    const from = $pos.before(1);
    const to = $pos.after(1);
    const prose = top.type.name === "paragraph" || top.type.name === "slot";
    const nodes: ReportNode[] = (prose ? evidenceBlocks(entry) : evidenceNodes(entry)).map((n) =>
      n.type === "evidence" && evidenceAttrs ? { ...n, attrs: { ...n.attrs, ...evidenceAttrs } } : n,
    );
    const made = nodes.map((n) => state.schema.nodeFromJSON(n));
    if (dispatch) {
      const tr = top.type.name === "paragraph" && top.content.size === 0 ? state.tr.replaceWith(from, to, made) : state.tr.insert(to, made);
      dispatch(tr.scrollIntoView());
    }
    return true;
  });
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

/**
 * Whether a block can move to an appendix (§5.6, §10.4): evidence, a generated table, a modified exploit. An unmodified
 * exploit is one line (its URL), so it stays.
 */
export function blockMovable(node: PMNode, data: ReportData): boolean {
  if (node.type.name === "evidence" || node.type.name === "generated") return true;
  if (node.type.name !== "exploit") return false;
  return data.findingFiles.find((f) => f.id === node.attrs.fileId)?.modified === true;
}

/** Moves a block to the appendix or back inline: its `appendix` attr, one undoable step. */
export function setBlockAppendix(editor: Editor, block: { node: PMNode; pos: number }, place: AppendixPlacement): boolean {
  return editor.exec((state, dispatch) => {
    const pos = currentPos(editor, block);
    if (pos === null) return false;
    dispatch?.(state.tr.setNodeMarkup(pos, undefined, { ...block.node.attrs, appendix: place }));
    return true;
  });
}

/** Deletes a block; an evidence block's entry is remembered as removed (`onRemoveEvidence`), as ⌫ does. */
export function deleteBlockAt(editor: Editor, block: { node: PMNode; pos: number }, onRemoveEvidence: (entryId: string) => void): boolean {
  return editor.exec((state, dispatch) => {
    const pos = currentPos(editor, block);
    if (pos === null) return false;
    if (dispatch) {
      if (block.node.type.name === "evidence") onRemoveEvidence(block.node.attrs.entryId as string);
      dispatch(state.tr.delete(pos, pos + block.node.nodeSize));
    }
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

/** Lines in an output, as the rail counts them (a trailing newline ends the last line, it opens none). */
const outputLines = (text: string) => (text === "" ? 0 : text.replace(/\n$/, "").split(/\r?\n/).length);

/** Whether an evidence block of `entry` prints more than `MAX_INLINE_LINES` lines of output. */
function tooLong(entry: LogEntry, attrs: Record<string, unknown> | undefined): boolean {
  if (entry.content.kind !== "command") return false;
  const block = typeof attrs?.block === "number" ? attrs.block : null;
  const blocks = block === null ? entry.content.blocks : entry.content.blocks.slice(block, block + 1);
  return blocks.some((b) => outputLines(b.output ?? "") > MAX_INLINE_LINES);
}

/** `nodes` with the entry's evidence blocks (at any depth) that are too long to print set to `place`; the rest of
 *  its blocks stay inline. */
function withAppendix(nodes: ReportNode[], entry: LogEntry, place: AppendixPlacement): ReportNode[] {
  return nodes.map((n) => ({
    ...n,
    ...(n.type === "evidence" && n.attrs?.entryId === entry.id && tooLong(entry, n.attrs) ? { attrs: { ...n.attrs, appendix: place } } : {}),
    ...(n.content ? { content: withAppendix(n.content, entry, place) } : {}),
  }));
}

/**
 * The rail's + add (§10.1): the entry's evidence into the step that holds the cursor (no new step; `cursor` says the
 * owner has put one on the page), else a new step at the end of its phase (`endOfPhase`). + to appendix (`toAppendix`)
 * places it the same way with its long evidence split (trimmed inline, in full in the appendix); its short blocks stay
 * inline. One undoable step.
 */
export function addEntryCommand(
  state: EditorState,
  cursor: boolean,
  data: ReportData,
  target: ReportTarget,
  entry: LogEntry,
  toAppendix = false,
): Command {
  const finish = (nodes: ReportNode[]) => (toAppendix ? withAppendix(nodes, entry, "split") : nodes).map((n) => state.schema.nodeFromJSON(n));
  const inStep = cursor ? insertIntoCurrentStep(state, finish(evidenceBlocks(entry))) : null;
  if (inStep) return inStep;
  return (s, dispatch) => {
    const { at, nodes } = endOfPhase(s.doc.toJSON() as ReportNode, data, target, entry);
    const pos = pathPos(s.doc, at);
    if (pos === null) return false;
    dispatch?.(s.tr.insert(pos, finish(nodes)).scrollIntoView());
    return true;
  };
}
