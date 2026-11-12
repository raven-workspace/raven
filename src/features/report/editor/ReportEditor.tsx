import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { createEditor, Priority, union, type Editor, type NodeJSON } from "prosekit/core";
import { defineFileDropHandler, defineFilePasteHandler } from "prosekit/extensions/file";
import type { Node as PMNode } from "prosekit/pm/model";
import { NodeSelection, type Command } from "prosekit/pm/state";
import { ProseKit, useDocChange, useExtension, useKeymap } from "prosekit/react";
import { ownerParagraphs, isFigure, stepTitleBefore, type DocPath, type EvidenceAttrs, type PageHeadings, type ReportData, type ReportNode } from "../../../engines/report";
import { reportError } from "../../../lib/lockSignal";
import { RavenError } from "../../../types/errors";
import { BlockHandle } from "./BlockHandle";
import { BubbleMenu } from "./BubbleMenu";
import { CHIP_TYPES, chipKey, ChipStateProvider, useChipControls } from "./ChipState";
import { defineReportExtension, type HeldPositions, type SourceGone, type SubNumbers } from "./extension";
import { FindBar } from "./FindBar";
import { FormatToolbar } from "./FormatToolbar";
import { hostAtPos, PageActionsContext, pathPos, placeEntry, saveScreenshot, type PageActions } from "./pageActions";
import { PageLayoutContext, useReportData, type PageLayout } from "./ReportDataContext";
import { SlashMenu } from "./SlashMenu";
import { TableHandles } from "./TableHandles";
import "../page.css";

/** Whether an evidence node shows a screenshot on the page, so it takes a figure number (a moved one doesn't). */
const hasFigure = (node: PMNode, data: ReportData) =>
  isFigure({ type: node.type.name, attrs: node.attrs }, (id) => data.log.find((e) => e.id === id));

/** Figure numbers, index paths and fallback captions' step titles for the current document, keyed by node (nodes are immutable per state). */
function layoutOf(doc: PMNode, data: ReportData, sectionId: string, figureOffset: number, touched: boolean, headings: PageHeadings | null): PageLayout {
  const figures = new Map<PMNode, number>();
  const paths = new Map<PMNode, string>();
  const stepped = new Set<PMNode>();
  const walk = (node: PMNode, path: string) =>
    node.forEach((child, _offset, i) => {
      const p = path === "" ? `${i}` : `${path}.${i}`;
      paths.set(child, p);
      if (node.type.name === "step") stepped.add(child);
      if (hasFigure(child, data)) figures.set(child, figureOffset + figures.size + 1);
      walk(child, p);
    });
  walk(doc, "");
  // An uncaptioned screenshot's caption falls back to the step it tags along with: the block above it, as it is now.
  const entryOf = (id: string) => data.log.find((e) => e.id === id);
  const top: { type: string; attrs: Record<string, unknown> }[] = [];
  doc.forEach((n) => top.push({ type: n.type.name, attrs: n.attrs }));
  const steps = new Map<PMNode, string | null>();
  doc.forEach((child, _offset, i) => {
    if (child.type.name === "evidence" && entryOf(String(child.attrs.entryId))?.kind === "screenshot") steps.set(child, stepTitleBefore(top, i, entryOf));
  });
  return {
    sectionId,
    figureOf: (n) => figures.get(n) ?? null,
    pathOf: (n) => paths.get(n) ?? null,
    stepTitleOf: (n) => steps.get(n) ?? null,
    inStep: (n) => stepped.has(n),
    touched,
    heading: (key) => headings?.get(key) ?? null,
  };
}

/** Each page's held positions (see `HeldPositions`), by its editor. */
const heldPositions = new WeakMap<Editor, HeldPositions>();

/** Each page's numbering holder (see `SubNumbers`), by its editor. */
const pageNumbers = new WeakMap<Editor, SubNumbers>();

/** Each page's copied-text source lookup (see `SourceGone`), by its editor. */
const sourcesGone = new WeakMap<Editor, SourceGone>();

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

/** Inserts nodes at a path (`DocPath`: top-level index, then child indices; the last is where the nodes go in their
 *  parent), as `endOfPhase` returns it. */
export function insertNodesAt(editor: Editor, path: DocPath, nodes: ReportNode[]): boolean {
  return editor.exec((state, dispatch) => {
    const at = pathPos(state.doc, path);
    if (at === null) return false;
    dispatch?.(state.tr.insert(at, nodes.map((n) => state.schema.nodeFromJSON(n))).scrollIntoView());
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

/** Makes text copied from a log entry the owner's own: every block that came from `entryId` drops its source, so it
 *  no longer follows that entry's privacy or deletion. One transaction, so one undo brings the link back. */
export function keepCopiedText(editor: Editor, entryId: string): boolean {
  return editor.exec((state, dispatch) => {
    const tr = state.tr;
    state.doc.descendants((node, pos) => {
      if (node.attrs.fromEntry !== entryId) return true;
      const attrs: Record<string, unknown> = { ...node.attrs, fromEntry: null };
      if ("fromField" in attrs) attrs.fromField = null;
      tr.setNodeMarkup(pos, undefined, attrs);
      return false;
    });
    if (!tr.docChanged) return false;
    dispatch?.(tr);
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
 * Brings the page to `after`, a copy of `before` (the page as it is) with blocks added (at the top level or inside a
 * block, such as a step in a steps list) and none removed or reordered, by inserting only the new blocks, so the
 * owner's cursor and history stay. Returns the inserted nodes.
 */
export function insertAdded(editor: Editor, before: ReportNode, after: ReportNode): PMNode[] {
  const inserted: number[] = [];
  const same = (a: ReportNode, b: ReportNode) => a === b || JSON.stringify(a) === JSON.stringify(b);
  // The same steps list or step with blocks added inside it (`addNewEvidence` adds steps and evidence there).
  const grown = (a: ReportNode, b: ReportNode) =>
    (a.type === "steps" || a.type === "step") && a.type === b.type && JSON.stringify(a.attrs ?? null) === JSON.stringify(b.attrs ?? null);
  editor.exec((state, dispatch) => {
    const tr = state.tr;
    // Walks `now` against `was`, the children of the node whose content starts at `start`. Insertions only ever land
    // after every position recorded so far, so those stay valid.
    const merge = (was: ReportNode[], now: ReportNode[], start: number) => {
      let pos = start;
      let j = 0;
      for (const n of now) {
        if (j < was.length && (same(n, was[j]) || grown(n, was[j]))) {
          if (!same(n, was[j])) merge(was[j].content ?? [], n.content ?? [], pos + 1);
          pos += tr.doc.nodeAt(pos)!.nodeSize;
          j++;
          continue;
        }
        const made = state.schema.nodeFromJSON(n);
        tr.insert(pos, made);
        inserted.push(pos);
        pos += made.nodeSize;
      }
    };
    merge(before.content ?? [], after.content ?? [], 0);
    dispatch?.(tr);
    return true;
  });
  const doc = editor.state.doc;
  return inserted.map((p) => doc.nodeAt(p)).filter((n): n is PMNode => n !== null);
}

/** Removes these exact nodes (top-level or nested) where they still stand unchanged; ones the owner has since edited stay. */
export function removeExact(editor: Editor, nodes: PMNode[]): boolean {
  const set = new Set(nodes);
  return editor.exec((state, dispatch) => {
    const spans: [number, number][] = [];
    state.doc.descendants((child, pos) => {
      if (!set.has(child)) return true;
      spans.push([pos, pos + child.nodeSize]);
      return false;
    });
    if (spans.length === 0) return false;
    const tr = state.tr;
    for (const [from, to] of spans.reverse()) tr.delete(from, to);
    dispatch?.(tr);
    return true;
  });
}

/**
 * Turns note entries that a page saved as frozen blocks into the paragraphs the owner edits (text copied, the entry kept
 * as `fromEntry`): one transaction, so one undo brings the blocks back. A note that is gone or private stays a block,
 * so its amber placeholder still shows.
 */
export function convertNoteBlocks(editor: Editor, data: ReportData): boolean {
  return editor.exec((state, dispatch) => {
    const spans: { from: number; to: number; nodes: ReportNode[] }[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name !== "evidence") return true;
      const entry = data.log.find((e) => e.id === node.attrs.entryId);
      if (entry && !entry.private && entry.content.kind === "note") spans.push({ from: pos, to: pos + node.nodeSize, nodes: ownerParagraphs(entry.content.text, entry.id) });
      return false;
    });
    if (spans.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const span of spans.reverse()) tr.replaceWith(span.from, span.to, span.nodes.map((n) => state.schema.nodeFromJSON(n)));
      dispatch(tr);
    }
    return true;
  });
}

/** Each page's find bar opener, by its editor: ⌘F in the Report view opens it (`openFindBar`). */
const findOpeners = new WeakMap<Editor, () => void>();

/** Opens the page's find bar, or puts focus back in it when it is open. */
export function openFindBar(editor: Editor): boolean {
  const open = findOpeners.get(editor);
  open?.();
  return open !== undefined;
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

/** Editor hooks that need the ProseKit context: change reporting, the page's keys, and images pasted or dropped. */
function PageHooks({
  onDoc,
  onRemoveEvidence,
  onImage,
}: {
  onDoc(doc: PMNode): void;
  onRemoveEvidence(entryId: string): void;
  onImage(file: File, pos?: number): void;
}) {
  useDocChange(onDoc);
  // `onImage` is the page's own, made once per editor, so the handlers register once.
  useExtension(
    useMemo(
      () =>
        union(
          defineFilePasteHandler(({ file }) => {
            if (!file.type.startsWith("image/")) return false;
            onImage(file);
            return true;
          }),
          defineFileDropHandler(({ file, pos }) => {
            if (!file.type.startsWith("image/")) return false;
            onImage(file, pos);
            return true;
          }),
        ),
      [onImage],
    ),
  );
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
  // A selected chip in a step: ↵ opens it, Esc closes it (the selection stays on it).
  const chips = useChipControls();
  const chipKeys = useMemo(() => {
    const selectedChip = (state: Parameters<Command>[0]) => {
      const sel = state.selection;
      if (!(sel instanceof NodeSelection) || !CHIP_TYPES.has(sel.node.type.name) || sel.$from.parent.type.name !== "step") return null;
      return chipKey(sel.node);
    };
    const toggle =
      (open: boolean): Command =>
      (state, dispatch) => {
        const key = selectedChip(state);
        if (key === null || chips.isOpen(key) === open) return false;
        if (dispatch) chips.setOpen(key, open);
        return true;
      };
    return { Enter: toggle(true), Escape: toggle(false) };
  }, [chips]);
  useKeymap(chipKeys, { priority: Priority.high });
  return null;
}

/**
 * One section's page: a ProseKit editor on paper, under a formatting toolbar that pins to the top of the page pane,
 * with a drag handle in the page's left gutter. The document is read once at mount; key it by section.
 */
export function ReportEditor({
  sectionId,
  title,
  titleNumber,
  subNumbers,
  doc,
  onChange,
  onReady,
  toolbarEnd,
  toolbarClassName,
  notices,
}: {
  sectionId: string;
  /** A report-level page's title, printed at the top of the paper; it comes from the section kind and is never stored. */
  title?: string;
  /** The title's number ("3"), printed before it as OffSec's sample does. */
  titleNumber?: string;
  /** A numbered report-level page's sub-section numbers (3.1, 3.2, as OffSec's sample), from its live document, by
   *  top-level index; computed, never stored. */
  subNumbers?(doc: ReportNode): Map<number, string>;
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
  const editor = useMemo(() => {
    const numbers: SubNumbers = { current: undefined };
    const held: HeldPositions = new Set();
    const gone: SourceGone = { current: undefined };
    const made = createEditor({ extension: defineReportExtension(numbers, held, gone), defaultContent: initialDoc as NodeJSON });
    pageNumbers.set(made, numbers);
    heldPositions.set(made, held);
    sourcesGone.set(made, gone);
    return made;
  }, [initialDoc]);
  // Copied text whose entry went private or was deleted shows in amber, from the live log: redrawn when it changes.
  const log = value.data.log;
  useLayoutEffect(() => {
    const holder = sourcesGone.get(editor);
    if (!holder) return;
    holder.current = (id) => {
      const e = log.find((x) => x.id === id);
      return !e ? "deleted" : e.private ? "private" : null;
    };
    if (editor.mounted) editor.view.updateState(editor.view.state);
  }, [editor, log]);
  // The numbering plugin reads the current numbering as the page redraws; set before the page mounts.
  useLayoutEffect(() => {
    const holder = pageNumbers.get(editor);
    if (!holder || holder.current === subNumbers) return;
    holder.current = subNumbers;
    // Redraw so the headings take the numbers now, not at the next keystroke.
    if (editor.mounted) editor.view.updateState(editor.view.state);
  });
  const [current, setCurrent] = useState<PMNode>(() => editor.state.doc);
  const figureOffset = value.figureOffset ?? 0;
  // `touched` (what hasPageCursor reads) is the one record; this count only re-renders the page when it changes.
  const [touches, countTouch] = useReducer((n: number) => n + 1, 0);
  const pageTouched = touches > 0 && touched.has(editor);
  const headingsOf = value.headingsOf;
  const layout = useMemo(
    () => layoutOf(current, value.data, sectionId, figureOffset, pageTouched, headingsOf ? headingsOf(current.toJSON() as ReportNode) : null),
    [current, value.data, sectionId, figureOffset, pageTouched, headingsOf],
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
  // The page's data for handlers that run outside render (the mount, a paste finishing).
  const live = useRef(value);
  useEffect(() => {
    live.current = value;
  });
  const qc = useQueryClient();
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const actions = useMemo((): PageActions => {
    const addImage = (file: File, pos?: number) => {
      const { data, target } = live.current;
      // Where the paste or drop happened, carried through whatever the owner types while the image saves.
      const spot = { pos: pos ?? editor.state.selection.from };
      const held = heldPositions.get(editor);
      held?.add(spot);
      const hostId = hostAtPos(editor, spot.pos, target);
      setImageError(null);
      saveScreenshot(qc, data.engagement.id, hostId ? [hostId] : [], file)
        .then((entry) => {
          if (!editor.mounted) return;
          // The caption is the page's to write.
          placeEntry(editor, entry, Math.min(spot.pos, editor.state.doc.content.size), { caption: "" });
        })
        .finally(() => held?.delete(spot))
        .catch((e: unknown) => {
          reportError(e);
          setImageError(RavenError.from(e).message);
        });
    };
    return { addImage, pickImage: () => fileInput.current?.click() };
  }, [editor, qc]);

  // Once the page is up, frozen note blocks become text, saved like any change (the page's change reporting may not
  // be listening yet).
  useEffect(() => {
    if (editor.mounted && convertNoteBlocks(editor, live.current.data)) onDoc(editor.state.doc);
  }, [editor, onDoc]);

  const [find, setFind] = useState<{ open: boolean; focus: number }>({ open: false, focus: 0 });
  const openFind = useCallback(() => setFind((f) => ({ open: true, focus: f.focus + 1 })), []);
  useEffect(() => {
    findOpeners.set(editor, openFind);
    return () => void findOpeners.delete(editor);
  }, [editor, openFind]);

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
      <ChipStateProvider>
        <ProseKit editor={editor}>
          <PageActionsContext.Provider value={actions}>
            <PageHooks onDoc={onDoc} onRemoveEvidence={value.onRemoveEvidence} onImage={actions.addImage} />
            <FormatToolbar
              end={toolbarEnd}
              className={toolbarClassName}
              onFind={openFind}
              findBar={find.open && <FindBar focusKey={find.focus} onClose={() => setFind((f) => ({ ...f, open: false }))} />}
            />
            {notices}
            {imageError && (
              <p role="alert" className="m-0 text-meta text-warn">
                Couldn't save the image as a screenshot: {imageError}
              </p>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) actions.addImage(file);
              }}
            />
            <div className="report-page" data-page={value.target ? "target" : "report"}>
              {title && (
                <h1 className="report-title">
                  {titleNumber && <span className="report-num">{titleNumber}</span>}
                  {title}
                </h1>
              )}
              <div ref={mount} className="report-page-doc" />
              <BlockHandle />
              <TableHandles />
            </div>
            <BubbleMenu />
            <SlashMenu />
          </PageActionsContext.Provider>
        </ProseKit>
      </ChipStateProvider>
    </PageLayoutContext.Provider>
  );
}
