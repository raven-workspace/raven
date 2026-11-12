import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEditor, Priority, type Editor, type NodeJSON } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { NodeSelection, Selection, type Command } from "prosekit/pm/state";
import { ProseKit, useDocChange, useKeymap } from "prosekit/react";
import { isFigure, type EvidenceAttrs, type ReportData, type ReportNode } from "../../../engines/report";
import { defineReportExtension } from "./extension";
import { PageLayoutContext, useReportData, type PageLayout } from "./ReportDataContext";
import "../page.css";

/** Whether an evidence node shows a screenshot on the page, so it takes a figure number (a moved one doesn't). */
const hasFigure = (node: PMNode, data: ReportData) =>
  isFigure({ type: node.type.name, attrs: node.attrs }, (id) => data.log.find((e) => e.id === id));

/** Figure numbers and index paths for the current document, keyed by node (nodes are immutable per state). */
function layoutOf(doc: PMNode, data: ReportData, sectionId: string, figureOffset: number): PageLayout {
  const figures = new Map<PMNode, number>();
  const paths = new Map<PMNode, string>();
  const walk = (node: PMNode, path: string) =>
    node.forEach((child, _offset, i) => {
      const p = path === "" ? `${i}` : `${path}.${i}`;
      paths.set(child, p);
      if (hasFigure(child, data)) figures.set(child, figureOffset + figures.size + 1);
      walk(child, p);
    });
  walk(doc, "");
  return { sectionId, figureOf: (n) => figures.get(n) ?? null, pathOf: (n) => paths.get(n) ?? null };
}

/** Whether the owner has put a cursor on the page: a block selected, or the caret moved off the start of the page. */
export function hasPageCursor(editor: Editor): boolean {
  const { selection, doc } = editor.state;
  return selection instanceof NodeSelection || !selection.empty || selection.from !== Selection.atStart(doc).from;
}

/** Inserts nodes after the block the cursor is in, or after a selected block; it never replaces one. */
export function insertNodesAtCursor(editor: Editor, nodes: ReportNode[]): boolean {
  return editor.exec((state, dispatch) => {
    const made = nodes.map((n) => state.schema.nodeFromJSON(n));
    const { selection } = state;
    if (dispatch) {
      const at =
        selection instanceof NodeSelection ? selection.to : selection.$from.depth === 0 ? selection.from : selection.$from.after(1);
      dispatch(state.tr.insert(at, made).scrollIntoView());
    }
    return true;
  });
}

/** Inserts nodes among the page's top-level blocks, before the one at `index`. */
export function insertNodesAt(editor: Editor, index: number, nodes: ReportNode[]): boolean {
  return editor.exec((state, dispatch) => {
    const made = nodes.map((n) => state.schema.nodeFromJSON(n));
    let at = 0;
    state.doc.forEach((child, _offset, i) => {
      if (i < index) at += child.nodeSize;
    });
    dispatch?.(state.tr.insert(at, made).scrollIntoView());
    return true;
  });
}

/** Inserts an evidence block after the block the cursor is in, or after a selected block; it never replaces one. */
export function insertEvidenceAtCursor(editor: Editor, attrs: EvidenceAttrs): boolean {
  return insertNodesAtCursor(editor, [{ type: "evidence", attrs: attrs as unknown as Record<string, unknown> }]);
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
  const figureOffset = value.figureOffset ?? 0;
  const layout = useMemo(
    () => layoutOf(current, value.data, sectionId, figureOffset),
    [current, value.data, sectionId, figureOffset],
  );

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
