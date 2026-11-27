import type { Editor } from "prosekit/core";
import { SHORTCUTS, type Keys } from "../../../lib/shortcuts";
import { addTableRowBelow as addRowAfter, isCellSelection } from "prosekit/extensions/table";
import type { Node as PMNode } from "prosekit/pm/model";
import { NodeSelection, TextSelection, type Command } from "prosekit/pm/state";
import type { EditingExtension } from "./extension";

export type PageEditor = Editor<EditingExtension>;

/* Links */

/** The href of the link the cursor is in, or "". */
export function linkAt(editor: Editor): string {
  const { $from, from, to, empty } = editor.state.selection;
  const type = editor.schema.marks.link;
  const marks = empty ? [...$from.marks()] : [];
  if (!empty) editor.state.doc.nodesBetween(from, to, (n) => void marks.push(...n.marks));
  return (marks.find((m) => m.type === type)?.attrs.href as string | undefined) ?? "";
}

/** Links the selection (or the link the cursor is in) to `href`; an empty one unlinks. With no selection, the address goes in as linked text. */
export function applyLink(editor: PageEditor, href: string) {
  const { empty } = editor.state.selection;
  const inLink = linkAt(editor) !== "";
  if (empty && inLink) editor.commands.expandLink();
  if (href === "") {
    if (inLink) editor.commands.removeLink();
    return;
  }
  if (editor.state.selection.empty) {
    editor.exec((state, dispatch) => {
      dispatch?.(
        state.tr
          .insertText(href)
          .addMark(state.selection.from, state.selection.from + href.length, state.schema.marks.link.create({ href })),
      );
      return true;
    });
    return;
  }
  editor.commands.addLink({ href });
}

/* Block types */

/** What the toolbar's block-type select offers. */
export type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "quote" | "code";
export const HEADING_KINDS = ["h1", "h2", "h3"] as const;
export const BLOCK_KINDS: { value: BlockKind; label: string; shortcut: Keys }[] = [
  { value: "paragraph", label: "Paragraph", shortcut: SHORTCUTS.paragraph },
  { value: "h1", label: "Heading 1", shortcut: SHORTCUTS.heading1 },
  { value: "h2", label: "Heading 2", shortcut: SHORTCUTS.heading2 },
  { value: "h3", label: "Heading 3", shortcut: SHORTCUTS.heading3 },
  { value: "quote", label: "Quote", shortcut: SHORTCUTS.quote },
  { value: "code", label: "Code block", shortcut: "```" },
];

/** Whether the cursor is in one of the page's own numbered headings ("3.1 Information Gathering"): the drafted
 *  structure, which keeps its type. The owner's headings carry no number. */
export function inPageHeading(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name !== "heading" || $from.depth === 0 || !editor.mounted) return false;
  const dom = editor.view.nodeDOM($from.before());
  return dom instanceof HTMLElement && dom.hasAttribute("data-number");
}

/** The block type the cursor is in, as the select names it; null where it isn't one of them (a selected block, a
 *  numbered page heading). */
export function blockKindAt(editor: Editor): BlockKind | null {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection) return null;
  const parent = sel.$from.parent;
  if (parent.type.name === "codeBlock") return "code";
  if (parent.type.name === "heading") {
    if (inPageHeading(editor)) return null;
    const level = parent.attrs.level as number;
    return level === 1 ? "h1" : level === 2 ? "h2" : level === 3 ? "h3" : null;
  }
  for (let d = sel.$from.depth; d > 0; d--) if (sel.$from.node(d).type.name === "blockquote") return "quote";
  return parent.type.name === "paragraph" ? "paragraph" : null;
}

/** Toggles an owner heading on the cursor's block: on as `kind`, or back to a paragraph when it already is one. */
export function toggleHeading(editor: PageEditor, kind: (typeof HEADING_KINDS)[number]) {
  if (blockKindAt(editor) === kind) setBlockKind(editor, "paragraph");
  else setBlockKind(editor, kind);
}

/** Turns the cursor's block into `kind`. A quote wraps it; leaving a quote unwraps it first. */
export function setBlockKind(editor: PageEditor, kind: BlockKind) {
  // The page's numbered headings are its structure: they keep their type.
  if (inPageHeading(editor)) return;
  const inQuote = blockKindAt(editor) === "quote";
  if (inQuote && kind !== "quote") editor.commands.toggleBlockquote();
  switch (kind) {
    case "paragraph":
      editor.commands.setParagraph();
      return;
    case "h1":
    case "h2":
    case "h3":
      editor.commands.setHeading({ level: Number(kind[1]) });
      return;
    case "quote":
      if (!inQuote) editor.commands.toggleBlockquote();
      return;
    case "code":
      editor.commands.setCodeBlock({ language: "" });
      return;
  }
}

/* Tables */

/** An owner table: three columns, a header row and two rows to fill, with the cursor in its first cell. */
export function insertTable(editor: PageEditor) {
  const before = new Set<PMNode>();
  editor.state.doc.descendants((n) => void (n.type.name === "table" && before.add(n)));
  editor.commands.insertTable({ row: 3, col: 3, header: true });
  editor.exec((state, dispatch) => {
    let at = -1;
    state.doc.descendants((n, pos) => {
      if (at === -1 && n.type.name === "table" && !before.has(n)) at = pos;
      return at === -1;
    });
    if (at === -1) return false;
    // table > row > cell > paragraph: the paragraph's text starts 4 in.
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, at + 4)).scrollIntoView());
    return true;
  });
}

/** Where the cursor lands in each cell of the cursor's table (the end of its text), in reading order. */
function cellStarts(state: Parameters<Command>[0]): { starts: number[]; current: number } | null {
  const table = tableAt(state);
  if (!table) return null;
  const starts: number[] = [];
  let current = -1;
  const head = state.selection.from;
  table.node.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset) => {
      const from = table.pos + 1 + rowOffset + 1 + cellOffset;
      if (head > from && head < from + cell.nodeSize) current = starts.length;
      starts.push(from + cell.nodeSize - 2);
    });
  });
  return { starts, current };
}

/** Tab and ⇧Tab in a table: to the next or previous cell; Tab in the last cell adds a row. */
export const moveCell =
  (dir: 1 | -1): Command =>
  (state, dispatch, view) => {
    const cells = cellStarts(state);
    if (!cells || cells.current === -1) return false;
    const next = cells.current + dir;
    if (next < 0) return true;
    if (next >= cells.starts.length) {
      if (dispatch && view) {
        addRowAfter(state, dispatch);
        const again = cellStarts(view.state);
        if (again) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, again.starts[next])).scrollIntoView());
      }
      return true;
    }
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, cells.starts[next])).scrollIntoView());
    return true;
  };

/** The table the cursor (or a cell selection) is in, with its position. */
function tableAt(state: Parameters<Command>[0]): { node: PMNode; pos: number } | null {
  const $pos = isCellSelection(state.selection) ? state.selection.$anchorCell : state.selection.$from;
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "table") return { node, pos: $pos.before(d) };
  }
  return null;
}

/** Whether the table the cursor is in has a header row. */
export function hasHeaderRow(editor: Editor): boolean {
  const table = tableAt(editor.state);
  const first = table?.node.firstChild;
  return !!first && first.childCount > 0 && first.firstChild!.type.name === "tableHeaderCell";
}

/** Turns the first row of the cursor's table into a header row, or back into ordinary cells. */
export const toggleHeaderRow: Command = (state, dispatch) => {
  const table = tableAt(state);
  const row = table?.node.firstChild;
  if (!table || !row) return false;
  if (dispatch) {
    const header = row.firstChild?.type.name !== "tableHeaderCell";
    const to = state.schema.nodes[header ? "tableHeaderCell" : "tableCell"];
    const tr = state.tr;
    let pos = table.pos + 2;
    row.forEach((cell) => {
      tr.setNodeMarkup(pos, to, cell.attrs);
      pos += cell.nodeSize;
    });
    dispatch(tr);
  }
  return true;
};
