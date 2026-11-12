import type { QueryClient } from "@tanstack/react-query";
import type { Editor } from "prosekit/core";
import { createContext, useContext } from "react";
import { evidenceBlocks, evidenceNodes, type ReportNode, type ReportTarget } from "../../../engines/report";
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
