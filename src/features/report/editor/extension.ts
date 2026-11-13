import {
  defineBaseCommands,
  defineBaseKeymap,
  defineHistory,
  defineKeymap,
  defineNodeAttr,
  createEditor,
  defineNodeSpec,
  definePlugin,
  setBlockType,
  toggleMark,
  toggleNode,
  Priority,
  union,
  withPriority,
  withSkipCodeBlock,
  type Extension,
} from "prosekit/core";
import { defineBlockquote } from "prosekit/extensions/blockquote";
import { defineBold } from "prosekit/extensions/bold";
import { defineCode } from "prosekit/extensions/code";
import { defineCodeBlock, defineCodeBlockHighlight } from "prosekit/extensions/code-block";
import { defineDoc } from "prosekit/extensions/doc";
import { defineGapCursor } from "prosekit/extensions/gap-cursor";
import { defineHardBreak } from "prosekit/extensions/hard-break";
import { defineHeadingCommands, defineHeadingSpec } from "prosekit/extensions/heading";
import { defineHighlight } from "prosekit/extensions/highlight";
import { defineHorizontalRule } from "prosekit/extensions/horizontal-rule";
import { defineInputRule } from "prosekit/extensions/input-rule";
import { InputRule } from "prosekit/pm/inputrules";
import { defineItalic } from "prosekit/extensions/italic";
import { defineLink } from "prosekit/extensions/link";
import { defineList } from "prosekit/extensions/list";
import { defineModClickPrevention } from "prosekit/extensions/mod-click-prevention";
import { defineParagraph } from "prosekit/extensions/paragraph";
import { definePlaceholder } from "prosekit/extensions/placeholder";
import { defineSearchCommands } from "prosekit/extensions/search";
import { defineStrike } from "prosekit/extensions/strike";
import { defineSubscript } from "prosekit/extensions/subscript";
import { defineSuperscript } from "prosekit/extensions/superscript";
import { defineTable } from "prosekit/extensions/table";
import { defineText } from "prosekit/extensions/text";
import { defineUnderline } from "prosekit/extensions/underline";
import { defineVirtualSelection } from "prosekit/extensions/virtual-selection";
import type { Node as PMNode, Schema } from "prosekit/pm/model";
import { Plugin, PluginKey, type Command, type EditorState } from "prosekit/pm/state";
import { Decoration, DecorationSet } from "prosekit/pm/view";
import type { ReportNode } from "../../../engines/report";
import { defineReactNodeView } from "prosekit/react";
import { hljsParser } from "./codeHighlight";
import { moveCell } from "./commands";
import { CodeBlockView } from "./nodes/CodeBlockView";
import { FigureView } from "./nodes/FigureView";

/** Clicks and typing in controls inside a node view (the code block's language picker) stay with the control, not
 *  ProseMirror. */
const stopControlEvents = (event: Event) => event.target instanceof Element && event.target.closest("button, input, textarea, [role=combobox]") !== null;

/** A hidden attr: kept through the editor, copy and paste (as `data-*` on the DOM), never printed as text. */
const hiddenAttr = (type: string, attr: string, dom: string) =>
  defineNodeAttr({
    type,
    attr,
    default: null,
    toDOM: (value: string | null) => (value ? [dom, value] : null),
    parseDOM: (el: HTMLElement) => el.getAttribute(dom),
  });

/** The entry ids a block already shows (`also`): a list, a space-separated `data-also`. */
const alsoAttr = (type: string) =>
  defineNodeAttr({
    type,
    attr: "also",
    default: null,
    toDOM: (value: string[] | null) => (Array.isArray(value) && value.length > 0 ? ["data-also", value.join(" ")] : null),
    parseDOM: (el: HTMLElement) => el.getAttribute("data-also")?.split(" ").filter(Boolean) ?? null,
  });

/** The blocks that can carry a source: where it came from ("entry:<id>:<block>", "finding:<id>:fix", "ports:<hostId>"),
 *  its `gen` hash as generated (for Refresh and the checks), and `also`. */
const SOURCED = ["heading", "paragraph", "list", "codeBlock", "table", "figure"];
const sourcedAttrs = () =>
  union(
    ...SOURCED.flatMap((type) => [hiddenAttr(type, "source", "data-source"), hiddenAttr(type, "gen", "data-gen"), alsoAttr(type)]),
    // A paragraph's hint: shown in the editor while the paragraph is empty, never printed.
    hiddenAttr("paragraph", "hint", "data-hint"),
  );

/** A screenshot on the page: the image (by attachment) and its caption, ordinary editable text. The HTML is the PDF's
 *  contract: it fills `img[data-attachment]` with the file. */
const figureSpec = defineNodeSpec({
  name: "figure",
  group: "block",
  content: "inline*",
  draggable: true,
  attrs: { attachmentId: { default: "" }, entryId: { default: null } },
  parseDOM: [
    {
      tag: 'figure[data-report="figure"]',
      contentElement: "figcaption",
      getAttrs: (dom: HTMLElement) => ({ attachmentId: dom.getAttribute("data-attachment") ?? "", entryId: dom.getAttribute("data-entry") }),
    },
  ],
  toDOM: (node: PMNode) => [
    "figure",
    { "data-report": "figure", "data-attachment": node.attrs.attachmentId as string, ...(node.attrs.entryId ? { "data-entry": node.attrs.entryId as string } : {}) },
    ["img", { "data-attachment": node.attrs.attachmentId as string, alt: "" }],
    ["figcaption", 0],
  ],
});

/** Whether a paragraph is empty and has a hint to show. */
const showsHint = (node: PMNode) => node.type.name === "paragraph" && node.content.size === 0 && typeof node.attrs.hint === "string" && node.attrs.hint !== "";

/** An empty paragraph with a hint shows it (`p.report-hint[data-hint]`, drawn by page.css) until the owner types. */
const hintPlaceholders = definePlugin(
  new Plugin({
    props: {
      decorations: (state) => {
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (showsHint(node)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "report-hint", "data-hint": node.attrs.hint as string }));
          return !node.isTextblock;
        });
        return decos.length === 0 ? null : DecorationSet.create(state.doc, decos);
      },
    },
  }),
);

/** A numbered page's sub-section numbers by top-level index, read when the page redraws. */
export type SubNumbers = { current: ((doc: ReportNode) => Map<number, string>) | undefined };

/** Marks each numbered sub-section heading with its number (`data-number="3.1"`), which the page prints before it. */
function headingNumbers(numbers: SubNumbers) {
  return definePlugin(
    new Plugin({
      props: {
        decorations: (state) => {
          const of = numbers.current;
          if (!of) return null;
          const map = of(state.doc.toJSON() as ReportNode);
          if (map.size === 0) return null;
          const decos: Decoration[] = [];
          state.doc.forEach((node, offset, i) => {
            const n = map.get(i);
            if (n) decos.push(Decoration.node(offset, offset + node.nodeSize, { "data-number": n }));
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    }),
  );
}

/** Why a block's source entry no longer backs its text ("private", "deleted"), or null while it does; read as the page
 *  redraws. */
export type SourceGone = { current: ((entryId: string) => "private" | "deleted" | null) | undefined };

/** The log entry a block was copied from: a figure's `entryId`, else its `entry:<id>…` source. */
function entryOf(node: PMNode): string | null {
  if (node.type.name === "figure" && typeof node.attrs.entryId === "string" && node.attrs.entryId !== "") return node.attrs.entryId;
  const source = node.attrs.source as unknown;
  return typeof source === "string" ? (/^entry:([^:]+)/.exec(source)?.[1] ?? null) : null;
}

/**
 * Marks text copied from the log whose entry is now private or was deleted (`data-source-gone`): the page shows it in
 * amber, as it shows an evidence block whose entry went away.
 */
function sourceGoneMarks(gone: SourceGone) {
  return definePlugin(
    new Plugin({
      props: {
        decorations: (state) => {
          const of = gone.current;
          if (!of) return null;
          const decos: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            const from = entryOf(node);
            if (from === null) return true;
            const why = of(from);
            if (why) decos.push(Decoration.node(pos, pos + node.nodeSize, { "data-source-gone": why }));
            return false;
          });
          return decos.length === 0 ? null : DecorationSet.create(state.doc, decos);
        },
      },
    }),
  );
}

/** The longest code token kept on one line, as the Manual keeps its own; a longer one (a hash, base64) still breaks
 *  anywhere to fit the page. */
const TOKEN_MAX = 40;
/** A code token with a hyphen, dot, slash or other mark a browser may wrap at: "libcap-dev", "5.15.0-70.77". */
const BREAKABLE_TOKEN = /\S*[^\w\s]\S*/g;

/** The longest word in a table cell kept whole: a column is never narrower than it (its min-content width). */
const CELL_WORD_MAX = 32;
/** A word in a cell with a mark a browser may wrap at, which would break "CVE-2021-3156" at its hyphen. */
const MARKED_WORD = /[^\w\s]/;
/** A longer word's parts, each ending at a path or hyphen mark: "C:\", "Windows\", "Tasks\", "PrintSpoofer64.exe". */
const WORD_PART = /[^\\/-]*[\\/-]|[^\\/-]+/g;

/** A table cell's words, so a word that fits its column never breaks inside it. A short word with a hyphen, dot
 *  or slash keeps on one line (`report-cell-word`); a longer one breaks only between its parts, each an inline block
 *  (`report-cell-part`); a part (or a word with no marks) longer than CELL_WORD_MAX breaks anywhere to fit
 *  (`report-cell-long`). Plain words need nothing: a cell breaks only at spaces (page.css). */
function cellWords(cell: PMNode, at: number, decos: Decoration[]) {
  cell.descendants((node, pos) => {
    if (!node.isText) return true;
    const from = at + pos;
    for (const m of (node.text ?? "").matchAll(/\S+/g)) {
      const word = m[0];
      const start = from + m.index;
      if (word.length <= CELL_WORD_MAX) {
        if (word.length > 1 && MARKED_WORD.test(word)) decos.push(Decoration.inline(start, start + word.length, { class: "report-cell-word" }));
        continue;
      }
      const parts = [...word.matchAll(WORD_PART)];
      if (parts.length === 1) {
        decos.push(Decoration.inline(start, start + word.length, { class: "report-cell-long" }));
        continue;
      }
      for (const part of parts) {
        const long = part[0].length > CELL_WORD_MAX ? " report-cell-long" : "";
        decos.push(Decoration.inline(start + part.index, start + part.index + part[0].length, { class: `report-cell-part${long}` }));
      }
    }
    return false;
  });
}

function codeTokens(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    // A table cell's text, code or not, follows the cell's own rules.
    if (node.type.name === "tableCell" || node.type.name === "tableHeaderCell") {
      cellWords(node, pos + 1, decos);
      return false;
    }
    if (!node.isText) return true;
    if (parent?.type.name !== "codeBlock" && !node.marks.some((m) => m.type.name === "code")) return false;
    for (const m of (node.text ?? "").matchAll(BREAKABLE_TOKEN)) {
      if (m[0].length <= TOKEN_MAX) decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, { class: "report-token" }));
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

const codeTokensKey = new PluginKey<DecorationSet>("reportCodeTokens");

/** Code never wraps inside a short token that fits its line (`span.report-token`, an inline block in page.css): a line
 *  breaks between "apt-get" and "install", not at the hyphen in "apt-get". A table cell's words likewise (cellWords).
 *  Recomputed only when the page changes. */
const unbrokenCodeTokens = definePlugin(
  new Plugin<DecorationSet>({
    key: codeTokensKey,
    state: {
      init: (_, state) => codeTokens(state.doc),
      apply: (tr, set) => (tr.docChanged ? codeTokens(tr.doc) : set),
    },
    props: { decorations: (state) => codeTokensKey.getState(state) },
  }),
);

/** Marks the code block the cursor is in (`data-active`), so its language picker shows while the owner types in it. */
const activeCodeBlock = definePlugin(
  new Plugin({
    props: {
      decorations: (state) => {
        const { $head } = state.selection;
        for (let d = $head.depth; d > 0; d--) {
          const node = $head.node(d);
          if (node.type.name === "codeBlock") {
            const from = $head.before(d);
            return DecorationSet.create(state.doc, [Decoration.node(from, from + node.nodeSize, { "data-active": "" })]);
          }
        }
        return null;
      },
    },
  }),
);

/** Whether the cursor is in one of the page's numbered headings (the drafted structure), which keeps its type. */
function inNumberedHeading(state: EditorState, numbers: SubNumbers): boolean {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "heading" || $from.depth !== 1 || !numbers.current) return false;
  return numbers.current(state.doc.toJSON() as ReportNode).has($from.index(0));
}

/** A command that leaves the page's numbered headings as they are (and swallows its key there). */
const sparingStructure =
  (numbers: SubNumbers, command: Command): Command =>
  (state, dispatch, view) =>
    inNumberedHeading(state, numbers) ? true : command(state, dispatch, view);

/** The owner's headings: `# `, `## ` and `### ` at a line's start (they stay unnumbered: only the drafted structure
 *  takes numbers). Never inside a numbered heading. */
const headingRule = (numbers: SubNumbers) =>
  defineInputRule(
    new InputRule(/^(#{1,3})\s$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      if (inNumberedHeading(state, numbers) || !$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), state.schema.nodes.heading))
        return null;
      return state.tr.delete(start, end).setBlockType(start, start, state.schema.nodes.heading, { level: match[1]?.length ?? 1 });
    }),
  );

/** What list and quote markdown types at a line's start: `- `, `* `, `1. `, `[ ] `, `> `. */
const STRUCTURE_MARKDOWN = /^\s*(?:[-+*]|\d+[.)]|\[[\sxX]?\]|>)\s$/;

/**
 * Inside a numbered heading, list and quote markdown stays the text typed: the drafted structure keeps its type. Runs
 * before ProseKit's list and quote input rules, so they never see it.
 */
const guardStructureMarkdown = (numbers: SubNumbers) =>
  withPriority(
    definePlugin(
      new Plugin({
        props: {
          handleTextInput: (view, from, to, text) => {
            const { state } = view;
            if (!inNumberedHeading(state, numbers)) return false;
            const $from = state.doc.resolve(from);
            if (!STRUCTURE_MARKDOWN.test($from.parent.textBetween(0, $from.parentOffset) + text)) return false;
            view.dispatch(state.tr.insertText(text, from, to));
            return true;
          },
        },
      }),
    ),
    Priority.highest,
  );

/** The page's keys beyond ProseKit's own: headings 1 to 3, paragraph, sub- and superscript, table cells. */
const pageKeymap = (numbers: SubNumbers) =>
  defineKeymap({
    "Mod-Alt-0": sparingStructure(numbers, withSkipCodeBlock(setBlockType({ type: "paragraph" }))),
    "Mod-Alt-1": sparingStructure(numbers, withSkipCodeBlock(toggleNode({ type: "heading", attrs: { level: 1 } }))),
    "Mod-Alt-2": sparingStructure(numbers, withSkipCodeBlock(toggleNode({ type: "heading", attrs: { level: 2 } }))),
    "Mod-Alt-3": sparingStructure(numbers, withSkipCodeBlock(toggleNode({ type: "heading", attrs: { level: 3 } }))),
    Tab: moveCell(1),
    "Shift-Tab": moveCell(-1),
    "Mod-,": toggleMark({ type: "subscript" }),
    "Mod-.": toggleMark({ type: "superscript" }),
  });

/** What an empty block says while the cursor is in it. A hint paragraph shows its own hint, so it takes none here. */
function placeholderFor(state: EditorState): string {
  const parent = state.selection.$from.parent;
  if (showsHint(parent)) return "";
  if (parent.type.name === "heading") return "Heading";
  return "Write, or type / to insert";
}

/**
 * ProseKit's editing set for the page: its basic extension, copied so the owner's headings are levels 1 to 3 (no
 * image node: pictures come in as screenshots), plus highlight, sub- and superscript, placeholder, find and replace,
 * and code highlighting from the app's highlight.js. History is included once: a second defineHistory throws.
 */
function defineEditing(numbers: SubNumbers = { current: undefined }) {
  return union(
    defineDoc(),
    defineText(),
    defineParagraph(),
    defineHeadingSpec(),
    defineHeadingCommands(),
    headingRule(numbers),
    guardStructureMarkdown(numbers),
    defineList(),
    defineBlockquote(),
    defineHorizontalRule(),
    defineHardBreak(),
    defineTable(),
    defineCodeBlock(),
    defineCodeBlockHighlight({ parser: hljsParser }),
    defineItalic(),
    defineBold(),
    defineUnderline(),
    defineStrike(),
    defineCode(),
    defineLink(),
    defineHighlight(),
    defineSubscript(),
    defineSuperscript(),
    defineBaseKeymap(),
    defineBaseCommands(),
    defineHistory(),
    defineGapCursor(),
    defineVirtualSelection(),
    defineModClickPrevention(),
    definePlaceholder({ placeholder: placeholderFor }),
    defineSearchCommands(),
    pageKeymap(numbers),
  );
}

/** The editing set's typed commands, marks and nodes, for the page's chrome (`useEditor<EditingExtension>`). */
export type EditingExtension = ReturnType<typeof defineEditing>;

/** Positions held while something finishes elsewhere (a pasted image saving): each moves with the page's edits. */
export type HeldPositions = Set<{ pos: number }>;

function holdPositions(held: HeldPositions) {
  return definePlugin(
    new Plugin({
      state: {
        init: () => null,
        apply: (tr) => {
          if (tr.docChanged) for (const h of held) h.pos = tr.mapping.map(h.pos);
          return null;
        },
      },
    }),
  );
}

/** The report page's one schema and node views: the editing set, the figure and the hidden attrs every page uses. */
export function defineReportExtension(
  numbers: SubNumbers = { current: undefined },
  held: HeldPositions = new Set(),
  gone: SourceGone = { current: undefined },
): Extension {
  return union(
    headingNumbers(numbers),
    sourceGoneMarks(gone),
    holdPositions(held),
    defineEditing(numbers),
    activeCodeBlock,
    unbrokenCodeTokens,
    defineReactNodeView({ name: "codeBlock", component: CodeBlockView, as: "div", contentAs: "code", stopEvent: stopControlEvents }),
    sourcedAttrs(),
    hintPlaceholders,
    figureSpec,
    defineReactNodeView({ name: "figure", component: FigureView, as: "div", contentAs: "figcaption" }),
  );
}

let schema: Schema | null = null;
/** The page's schema on its own, to check a document before it is opened or saved (`nodeFromJSON(…).check()`). */
export function reportSchema(): Schema {
  return (schema ??= createEditor({ extension: defineReportExtension() }).schema);
}
