import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createEditor, definePlugin, Priority, union, type Editor, type NodeJSON } from "prosekit/core";
import { defineFileDropHandler, defineFilePasteHandler } from "prosekit/extensions/file";
import type { Node as PMNode } from "prosekit/pm/model";
import { isHistoryTransaction } from "prosekit/pm/history";
import { NodeSelection, Plugin, PluginKey, type Command, type Transaction } from "prosekit/pm/state";
import { ProseKit, useDocChange, useExtension, useKeymap } from "prosekit/react";
import { blockSource, placedIn, removalKeys, unlinkCopiedFrom, type ReportNode } from "../../../../engines/report/index";
import { reportError } from "../../../../lib/lockSignal";
import { RavenError } from "../../../../types/errors";
import { BlockHandle } from "../BlockHandle/BlockHandle";
import { BubbleMenu } from "../BubbleMenu/BubbleMenu";
import { defineReportExtension, type HeldPositions, type SourceGone, type SubNumbers } from "../extension";
import { FindBar } from "../FindBar/FindBar";
import { FormatToolbar } from "../FormatToolbar/FormatToolbar";
import { hostAtPos, insertFigure, PageActionsContext, PROGRAMMATIC, type PageActions } from "../pageActions";
import { saveScreenshot } from "../../../log/saveScreenshot";
import { usePageContext } from "../ReportDataContext/ReportDataContext";
import { SlashMenu } from "../SlashMenu/SlashMenu";
import { TableHandles } from "../TableHandles/TableHandles";
import "../../page.css";
import "./ReportEditor.scss";

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

/** Makes text copied from a log entry the owner's own: every block that came from `entryId` drops its source, so it
 *  no longer follows that entry's privacy or deletion. One transaction, so one undo brings the link back. */
export function keepCopiedText(editor: Editor, entryId: string): boolean {
  return editor.exec((state, dispatch) => {
    const tr = state.tr;
    state.doc.descendants((node, pos) => {
      const attrs = unlinkCopiedFrom({ type: node.type.name, attrs: node.attrs }, entryId);
      // Same size, so later positions hold; a list or table goes on to its own blocks with their sources.
      if (attrs) tr.setNodeMarkup(pos, undefined, attrs);
      return true;
    });
    if (!tr.docChanged) return false;
    dispatch?.(tr);
    return true;
  });
}

/** The position of the node at an index path from the doc root ("0.2.1"), as the "long block" checks name it. */
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

export { PROGRAMMATIC };

/** The removal keys of what a block places itself (`placedIn` on the block alone), not its children's. */
const ownEntryIds = (node: PMNode) => removalKeys(placedIn({ type: node.type.name, attrs: node.attrs }));

/**
 * What a transaction took off the page: entries (and Also tested lists) named by blocks in the ranges it deleted
 * (inside a list item too) that the page no longer names anywhere (`placedIn`'s rule: a block's source, a figure's
 * entry, an `also`, a machine's Also tested bullets). None for
 * the page's own transactions (`PROGRAMMATIC`) and for undo and redo.
 */
export function removedByTransaction(tr: Transaction): string[] {
  if (!tr.docChanged || tr.getMeta(PROGRAMMATIC) === true || isHistoryTransaction(tr)) return [];
  const gone = new Set<string>();
  tr.steps.forEach((step, i) => {
    const before = tr.docs[i];
    step.getMap().forEach((oldStart, oldEnd) => {
      if (oldEnd <= oldStart) return;
      before.nodesBetween(oldStart, oldEnd, (node) => {
        for (const id of ownEntryIds(node)) gone.add(id);
        return true;
      });
    });
  });
  if (gone.size === 0) return [];
  tr.doc.descendants((node) => {
    for (const id of ownEntryIds(node)) gone.delete(id);
    return gone.size > 0;
  });
  return [...gone];
}

/**
 * Words the owner deleted across blocks are no longer an entry's: when a user transaction deletes a range that spans
 * blocks and the block it leaves there is empty and still sourced from an entry (select a note's paragraphs and ⌫
 * leaves the first one, emptied), that block drops its source, `gen` and `also`: it shows nothing of them. Then the entry is off the
 * page when nothing else names it, and its removal is recorded. Appended to the owner's transaction, so one undo brings
 * both back. Clearing one block's own words keeps its link: the owner may be retyping it.
 */
export function emptiedBlocksPlugin() {
  return new Plugin({
    appendTransaction: (trs, _before, state) => {
      const spots: number[] = [];
      trs.forEach((tr, t) => {
        if (!tr.docChanged || tr.getMeta(PROGRAMMATIC) === true || isHistoryTransaction(tr)) return;
        tr.steps.forEach((step, i) => {
          const doc = tr.docs[i];
          step.getMap().forEach((oldStart, oldEnd, newStart) => {
            if (oldEnd <= oldStart || doc.resolve(oldStart).parent === doc.resolve(oldEnd).parent) return;
            // Where that spot is in the final doc: through the rest of this transaction, then the later ones.
            let pos = tr.mapping.slice(i + 1).map(newStart);
            for (const later of trs.slice(t + 1)) pos = later.mapping.map(pos);
            spots.push(pos);
          });
        });
      });
      const out = state.tr;
      for (const pos of spots) {
        if (pos > state.doc.content.size) continue;
        const at = state.doc.resolve(pos);
        const node = at.parent;
        if (at.depth === 0 || !node.isTextblock || node.content.size > 0) continue;
        if (blockSource({ type: node.type.name, attrs: node.attrs })?.kind !== "entry") continue;
        const attrs: Record<string, unknown> = { ...node.attrs };
        for (const key of ["source", "gen", "also"]) if (key in attrs) attrs[key] = null;
        out.setNodeMarkup(at.before(), undefined, attrs);
      }
      return out.docChanged ? out : null;
    },
  });
}

const removalKey = new PluginKey<{ ids: string[] } | null>("ravenRemovedEvidence");

/** Reports each entry a user transaction takes off the page (`removedByTransaction`) to `onRemove`, once, however it
 *  went: ⌫ on a block, step or list, the block menu's Delete, a text selection across steps, a cut. */
function removedEvidencePlugin(onRemove: (entryId: string) => void) {
  return new Plugin<{ ids: string[] } | null>({
    key: removalKey,
    state: {
      init: () => null,
      apply: (tr, prev) => {
        const ids = removedByTransaction(tr);
        return ids.length > 0 ? { ids } : prev;
      },
    },
    view: (view) => {
      let seen = removalKey.getState(view.state);
      return {
        update: (v) => {
          const now = removalKey.getState(v.state);
          if (now === seen) return;
          seen = now;
          now?.ids.forEach((id) => onRemove(id));
        },
      };
    },
  });
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
    dispatch?.(tr.setMeta(PROGRAMMATIC, true));
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

const BLOCK_KEYS = { "Alt-ArrowUp": moveSelectedBlock(-1), "Alt-ArrowDown": moveSelectedBlock(1) };

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
  // Whatever takes evidence off the page is remembered as removed, so Add new evidence never brings it back.
  useExtension(useMemo(() => definePlugin(removedEvidencePlugin(onRemoveEvidence)), [onRemoveEvidence]));
  useExtension(useMemo(() => definePlugin(emptiedBlocksPlugin()), []));
  useKeymap(BLOCK_KEYS, { priority: Priority.high });
  return null;
}

/**
 * One section's page: a ProseKit editor on paper, under a formatting toolbar that pins to the top of the page pane,
 * with a drag handle in the page's left gutter. The document is read once at mount; key it by section.
 */
export function ReportEditor({
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
  const value = usePageContext();
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
  const callbacks = useRef({ onChange, onReady });
  useEffect(() => {
    callbacks.current = { onChange, onReady };
  });
  useEffect(() => {
    callbacks.current.onReady(editor);
  }, [editor]);

  const onDoc = useCallback(
    () => {
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
        .then(({ entry, failed }) => {
          // Saved even when a step after the save failed: the figure goes in, and the step's message shows.
          if (failed) setImageError(failed.message);
          if (!editor.mounted) return;
          // The caption is the page's to write.
          insertFigure(editor, entry, spot.pos);
        })
        .finally(() => held?.delete(spot))
        .catch((e: unknown) => {
          reportError(e);
          setImageError(`Couldn't save the image as a screenshot: ${RavenError.from(e).message}`);
        });
    };
    return { addImage, pickImage: () => fileInput.current?.click() };
  }, [editor, qc]);

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
          <p role="alert" className="report-editor__alert">
            {imageError}
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
  );
}
