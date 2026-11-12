import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEditor, Priority, type Editor, type NodeJSON } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { NodeSelection, type Command } from "prosekit/pm/state";
import { ProseKit, useDocChange, useKeymap } from "prosekit/react";
import type { EvidenceAttrs, ReportData, ReportNode } from "../../../engines/report";
import { defineReportExtension } from "./extension";
import { PageLayoutContext, useReportData, type PageLayout } from "./ReportDataContext";
import "../page.css";

/** Whether an evidence node shows a screenshot, so it takes a figure number. */
function hasFigure(node: PMNode, data: ReportData): boolean {
  if (node.type.name !== "evidence") return false;
  const entry = data.log.find((e) => e.id === node.attrs.entryId);
  if (!entry || entry.private) return false;
  return entry.content.kind === "screenshot" || (entry.content.kind === "flag" && !!entry.content.attachmentId);
}

/** Figure numbers and index paths for the current document, keyed by node (nodes are immutable per state). */
function layoutOf(doc: PMNode, data: ReportData, sectionId: string): PageLayout {
  const figures = new Map<PMNode, number>();
  const paths = new Map<PMNode, string>();
  const walk = (node: PMNode, path: string) =>
    node.forEach((child, _offset, i) => {
      const p = path === "" ? `${i}` : `${path}.${i}`;
      paths.set(child, p);
      if (hasFigure(child, data)) figures.set(child, figures.size + 1);
      walk(child, p);
    });
  walk(doc, "");
  return { sectionId, figureOf: (n) => figures.get(n) ?? null, pathOf: (n) => paths.get(n) ?? null };
}

/** Inserts an evidence block after the block the cursor is in (or over a selected block). */
export function insertEvidenceAtCursor(editor: Editor, attrs: EvidenceAttrs): boolean {
  return editor.exec((state, dispatch) => {
    const node = state.schema.nodes.evidence.create(attrs);
    const { selection } = state;
    if (dispatch) {
      const tr =
        selection instanceof NodeSelection || selection.$from.depth === 0
          ? state.tr.replaceSelectionWith(node)
          : state.tr.insert(selection.$from.after(1), node);
      dispatch(tr.scrollIntoView());
    }
    return true;
  });
}

/** Removes the node that starts at `pos`. */
export function removeNodeAt(editor: Editor, pos: number): boolean {
  return editor.exec((state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node) return false;
    dispatch?.(state.tr.delete(pos, pos + node.nodeSize));
    return true;
  });
}

/** Merges `attrs` into the attributes of the node at `pos`. */
export function setNodeAttrs(editor: Editor, pos: number, attrs: Record<string, unknown>): boolean {
  return editor.exec((state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node) return false;
    dispatch?.(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
    return true;
  });
}

/** Moves the selected block one sibling up (-1) or down (1), keeping it selected. */
const moveSelectedBlock =
  (dir: -1 | 1): Command =>
  (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof NodeSelection) || !sel.node.isBlock) return false;
    const $pos = state.doc.resolve(sel.from);
    const index = $pos.index();
    const sibling = $pos.parent.maybeChild(index + dir);
    if (!sibling) return false;
    if (dispatch) {
      const to = dir === -1 ? sel.from - sibling.nodeSize : sel.from + sibling.nodeSize;
      const tr = state.tr.delete(sel.from, sel.to).insert(to, sel.node);
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, to)).scrollIntoView());
    }
    return true;
  };

/** Editor hooks that need the ProseKit context: change reporting and the page's keys. */
function PageHooks({ onDoc, onRemoveEvidence }: { onDoc(doc: PMNode): void; onRemoveEvidence(entryId: string): void }) {
  useDocChange(onDoc);
  const keymap = useMemo(() => {
    const removeEvidence: Command = (state, dispatch) => {
      const sel = state.selection;
      if (!(sel instanceof NodeSelection) || sel.node.type.name !== "evidence") return false;
      if (dispatch) {
        onRemoveEvidence(sel.node.attrs.entryId as string);
        dispatch(state.tr.deleteSelection().scrollIntoView());
      }
      return true;
    };
    return { Backspace: removeEvidence, Delete: removeEvidence, "Alt-ArrowUp": moveSelectedBlock(-1), "Alt-ArrowDown": moveSelectedBlock(1) };
  }, [onRemoveEvidence]);
  useKeymap(keymap, { priority: Priority.high });
  return null;
}

/** One section's page: a ProseKit editor on paper. The document is read once at mount; key it by section. */
export function ReportEditor({
  sectionId,
  doc,
  onChange,
  onReady,
}: {
  sectionId: string;
  doc: ReportNode;
  onChange(doc: ReportNode): void;
  onReady(editor: Editor): void;
}) {
  const value = useReportData();
  const [initialDoc] = useState(doc);
  const editor = useMemo(
    () => createEditor({ extension: defineReportExtension(), defaultContent: initialDoc as NodeJSON }),
    [initialDoc],
  );
  const [current, setCurrent] = useState<PMNode>(() => editor.state.doc);
  const layout = useMemo(() => layoutOf(current, value.data, sectionId), [current, value.data, sectionId]);

  const callbacks = useRef({ onChange, onReady });
  useEffect(() => {
    callbacks.current = { onChange, onReady };
  });
  useEffect(() => {
    callbacks.current.onReady(editor);
  }, [editor]);

  const onDoc = useCallback(
    (next: PMNode) => {
      setCurrent(next);
      callbacks.current.onChange(editor.getDocJSON() as ReportNode);
    },
    [editor],
  );
  const mount = useCallback(
    (el: HTMLDivElement) => {
      editor.mount(el);
      return () => editor.unmount();
    },
    [editor],
  );

  return (
    <PageLayoutContext.Provider value={layout}>
      <ProseKit editor={editor}>
        <PageHooks onDoc={onDoc} onRemoveEvidence={value.onRemoveEvidence} />
        <div className="report-page">
          <div ref={mount} className="report-page-doc" />
        </div>
      </ProseKit>
    </PageLayoutContext.Provider>
  );
}
