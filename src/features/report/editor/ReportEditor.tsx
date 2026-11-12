import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { createEditor, Priority, type Editor, type NodeJSON } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { NodeSelection, type Command } from "prosekit/pm/state";
import { ProseKit, useDocChange, useKeymap } from "prosekit/react";
import { isFigure, type EvidenceAttrs, type ReportData, type ReportNode } from "../../../engines/report";
import { BlockHandle } from "./BlockHandle";
import { defineReportExtension } from "./extension";
import { FormatToolbar } from "./FormatToolbar";
import { PageLayoutContext, useReportData, type PageLayout } from "./ReportDataContext";
import "../page.css";

/** Whether an evidence node shows a screenshot on the page, so it takes a figure number (a moved one doesn't). */
const hasFigure = (node: PMNode, data: ReportData) =>
  isFigure({ type: node.type.name, attrs: node.attrs }, (id) => data.log.find((e) => e.id === id));

/** Figure numbers and index paths for the current document, keyed by node (nodes are immutable per state). */
function layoutOf(doc: PMNode, data: ReportData, sectionId: string, figureOffset: number, touched: boolean): PageLayout {
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
  return { sectionId, figureOf: (n) => figures.get(n) ?? null, pathOf: (n) => paths.get(n) ?? null, touched };
}

/** Pages the owner has focused: before that the selection is only ProseMirror's default (often the first block). */
const touched = new WeakSet<Editor>();

/** Whether the owner has put a cursor on the page: they focused or clicked into it. */
export function hasPageCursor(editor: Editor): boolean {
  return touched.has(editor);
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

/** The position of the node at an index path from the doc root ("0.2.1"), as appendix keys and move checks name it. */
export function posAtPath(doc: PMNode, path: string): number | null {
  let node = doc;
  let pos = -1;
  for (const part of path.split(".")) {
    const index = Number(part);
    if (!Number.isInteger(index) || index < 0 || index >= node.childCount) return null;
    pos += 1;
    for (let i = 0; i < index; i++) pos += node.child(i).nodeSize;
    node = node.child(index);
  }
  return pos < 0 ? null : pos;
}

/** Selects the block at `pos`, brings it into view and focuses the page. */
export function selectBlockAt(editor: Editor, pos: number) {
  const view = editor.view;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).scrollIntoView());
  (view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView?.({ block: "center" });
  view.focus();
}

/**
 * Brings the page to `after`, a copy of `before` (the page as it is) with top-level blocks added and none removed or
 * reordered, by inserting only the new blocks, so the owner's cursor and history stay. Returns the inserted nodes.
 */
export function insertAdded(editor: Editor, before: ReportNode, after: ReportNode): PMNode[] {
  const was = before.content ?? [];
  const now = after.content ?? [];
  const inserted: number[] = [];
  editor.exec((state, dispatch) => {
    const tr = state.tr;
    let pos = 0;
    let j = 0;
    for (const n of now) {
      if (j < was.length && (n === was[j] || JSON.stringify(n) === JSON.stringify(was[j]))) {
        pos += tr.doc.child(j + inserted.length).nodeSize;
        j++;
        continue;
      }
      const made = state.schema.nodeFromJSON(n);
      tr.insert(pos, made);
      inserted.push(pos);
      pos += made.nodeSize;
    }
    dispatch?.(tr);
    return true;
  });
  const doc = editor.state.doc;
  return inserted.map((p) => doc.nodeAt(p)).filter((n): n is PMNode => n !== null);
}

/** Removes these exact top-level nodes where they still stand unchanged; ones the owner has since edited stay. */
export function removeExact(editor: Editor, nodes: PMNode[]): boolean {
  const set = new Set(nodes);
  return editor.exec((state, dispatch) => {
    const spans: [number, number][] = [];
    state.doc.forEach((child, offset) => {
      if (set.has(child)) spans.push([offset, offset + child.nodeSize]);
    });
    if (spans.length === 0) return false;
    const tr = state.tr;
    for (const [from, to] of spans.reverse()) tr.delete(from, to);
    dispatch?.(tr);
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

/**
 * One section's page: a ProseKit editor on paper, under a formatting toolbar that pins to the top of the page pane,
 * with a drag handle in the page's left gutter. The document is read once at mount; key it by section.
 */
export function ReportEditor({
  sectionId,
  doc,
  onChange,
  onReady,
  toolbarEnd,
  toolbarClassName,
  notices,
}: {
  sectionId: string;
  doc: ReportNode;
  onChange(doc: ReportNode): void;
  onReady(editor: Editor): void;
  /** The page's own action, at the right end of the formatting bar. */
  toolbarEnd?: ReactNode;
  /** Extra classes for the bar (the section pulls it up over the pane's top padding where it comes first). */
  toolbarClassName?: string;
  /** Lines about the page (save warnings, "nothing logged yet"), between the bar and the paper. */
  notices?: ReactNode;
}) {
  const value = useReportData();
  const [initialDoc] = useState(doc);
  const editor = useMemo(
    () => createEditor({ extension: defineReportExtension(), defaultContent: initialDoc as NodeJSON }),
    [initialDoc],
  );
  const [current, setCurrent] = useState<PMNode>(() => editor.state.doc);
  const figureOffset = value.figureOffset ?? 0;
  // `touched` (what hasPageCursor reads) is the one record; this count only re-renders the page when it changes.
  const [touches, countTouch] = useReducer((n: number) => n + 1, 0);
  const pageTouched = touches > 0 && touched.has(editor);
  const layout = useMemo(
    () => layoutOf(current, value.data, sectionId, figureOffset, pageTouched),
    [current, value.data, sectionId, figureOffset, pageTouched],
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
      const mark = () => {
        if (touched.has(editor)) return;
        touched.add(editor);
        countTouch();
      };
      el.addEventListener("focusin", mark);
      el.addEventListener("pointerdown", mark);
      return () => {
        el.removeEventListener("focusin", mark);
        el.removeEventListener("pointerdown", mark);
        editor.unmount();
      };
    },
    [editor],
  );

  return (
    <PageLayoutContext.Provider value={layout}>
      <ProseKit editor={editor}>
        <PageHooks onDoc={onDoc} onRemoveEvidence={value.onRemoveEvidence} />
        <FormatToolbar end={toolbarEnd} className={toolbarClassName} />
        {notices}
        <div className="report-page">
          <div ref={mount} className="report-page-doc" />
          <BlockHandle />
        </div>
      </ProseKit>
    </PageLayoutContext.Provider>
  );
}
