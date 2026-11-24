import type { QueryClient } from "@tanstack/react-query";
import type { Editor } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { withBlockAppended, withoutAppended, type ReportNode } from "../../engines/report";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { RavenError } from "../../types/errors";
import type { Report, ReportSection } from "../../types/report";
import { putBlockBack, takeBlock } from "./editor/pageActions";
import { createPage, nextPosition, reportSectionsKey } from "./queries";
import { flushReports, forgetReportSave, isReportSaveQueued, patchCachedSection } from "./saveQueue";

/**
 * Move to appendix (spec §10.4): a block leaves the open page for the end of an appendix page, the owner's pick or a
 * new one. Both pages are written in one backend transaction, so either both change or neither does; the open page
 * then drops the block itself, as the page's own change (not the owner's removal, and out of ⌘Z). Undo, from the
 * move's notice, writes both back the same way and deletes a page the move created.
 */

/** A block moved to an appendix page, as its Undo needs it. */
export interface MovedBlock {
  sourceId: string;
  appendixId: string;
  /** The move created the appendix page: Undo deletes it. */
  created: boolean;
  /** Where the block stood on its page: an index path from the doc root. */
  path: number[];
  block: ReportNode;
}

const EMPTY_PAGE: ReportNode = { type: "doc", content: [{ type: "paragraph" }] };

const sectionsOf = (qc: QueryClient, reportId: string) => qc.getQueryData<ReportSection[]>(reportSectionsKey(reportId)) ?? [];

/** Writes what is queued. A page whose earlier write still hasn't landed (failed, refused) would land over the move
 *  later, so nothing moves while one does. */
async function settle(ids: string[]) {
  await flushReports();
  if (ids.some(isReportSaveQueued)) throw new RavenError("conflict", "an earlier change to this page isn't saved yet. Try again once it is");
}

function sectionIn(qc: QueryClient, reportId: string, id: string): ReportSection {
  const s = sectionsOf(qc, reportId).find((x) => x.id === id);
  if (!s) throw new RavenError("not_found", "that page no longer exists");
  return s;
}

/** Moves `block` from the open page (`editor`, section `sourceId`) to the end of the appendix page `appendixId`, or to
 *  a new appendix page when null. Rejects, with nothing changed, when either page can't be written. */
export async function moveToAppendix(
  qc: QueryClient,
  report: Report,
  editor: Editor,
  sourceId: string,
  block: { node: PMNode; pos: number },
  appendixId: string | null,
): Promise<MovedBlock> {
  await settle(appendixId === null ? [sourceId] : [sourceId, appendixId]);
  const source = sectionIn(qc, report.id, sourceId);
  const key = reportSectionsKey(report.id);
  let created: ReportSection | null = null;
  if (appendixId === null) {
    created = await createPage(report, "appendix", nextPosition(sectionsOf(qc, report.id)));
    const page = created;
    qc.setQueryData<ReportSection[]>(key, (list = []) => [...list, page]);
  }
  const dropCreated = async () => {
    if (!created) return;
    const id = created.id;
    await api.reportSectionDelete(report.id, id).catch(reportError);
    qc.setQueryData<ReportSection[]>(key, (list = []) => list.filter((s) => s.id !== id));
  };
  let saved = false;
  try {
    const appendix = created ?? sectionIn(qc, report.id, appendixId!);
    const taken = takeBlock(editor, block);
    if (!taken) throw new RavenError("not_found", "the block changed before it could move");
    const moved = block.node.toJSON() as ReportNode;
    const sourceDoc = taken.tr.doc.toJSON() as ReportNode;
    const appendixDoc = withBlockAppended(appendix.doc ?? EMPTY_PAGE, moved);
    await api.reportSectionsSave(report.id, [
      { id: source.id, doc: sourceDoc, meta: source.meta },
      { id: appendix.id, doc: appendixDoc, meta: appendix.meta },
    ]);
    saved = true;
    patchCachedSection(qc, source.id, { doc: sourceDoc });
    patchCachedSection(qc, appendix.id, { doc: appendixDoc });
    // The page as it is now (typing while the pages saved included): the block comes off it; its autosave writes the rest.
    const now = takeBlock(editor, block);
    if (now) editor.view.dispatch(now.tr);
    return { sourceId, appendixId: appendix.id, created: created !== null, path: taken.path, block: moved };
  } catch (e) {
    // A page made for a move that didn't happen goes again.
    if (!saved) await dropCreated();
    throw e;
  }
}

/** Undo of `moveToAppendix`, with the source page open in `editor`: the block goes back where it stood and off the
 *  appendix page (a page the move created is deleted). Rejects, with nothing changed, when it can't. */
export async function undoMoveToAppendix(qc: QueryClient, report: Report, editor: Editor, moved: MovedBlock): Promise<void> {
  await settle([moved.sourceId, moved.appendixId]);
  const source = sectionIn(qc, report.id, moved.sourceId);
  const appendix = sectionIn(qc, report.id, moved.appendixId);
  const node = editor.schema.nodeFromJSON(moved.block);
  const back = putBlockBack(editor, moved.path, node);
  if (!back) throw new RavenError("validation", "this page has nowhere to put the block back");
  const sourceDoc = back.doc.toJSON() as ReportNode;
  const appendixDoc = moved.created ? null : withoutAppended(appendix.doc ?? EMPTY_PAGE, moved.block);
  if (!moved.created && !appendixDoc) throw new RavenError("not_found", "the block changed on the appendix page. Move it back by hand");
  await api.reportSectionsSave(
    report.id,
    [{ id: source.id, doc: sourceDoc, meta: source.meta }, ...(appendixDoc ? [{ id: appendix.id, doc: appendixDoc, meta: appendix.meta }] : [])],
    moved.created ? appendix.id : null,
  );
  patchCachedSection(qc, source.id, { doc: sourceDoc });
  if (appendixDoc) patchCachedSection(qc, appendix.id, { doc: appendixDoc });
  else {
    forgetReportSave(appendix.id);
    qc.setQueryData<ReportSection[]>(reportSectionsKey(report.id), (list = []) => list.filter((s) => s.id !== appendix.id));
  }
  const now = putBlockBack(editor, moved.path, node);
  if (now) editor.view.dispatch(now);
}
