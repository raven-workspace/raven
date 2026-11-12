import {
  defineBaseCommands,
  defineBaseKeymap,
  defineHistory,
  defineKeymap,
  defineNodeAttr,
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
import type { Node as PMNode } from "prosekit/pm/model";
import { Plugin, type Command, type EditorState } from "prosekit/pm/state";
import { Decoration, DecorationSet } from "prosekit/pm/view";
import { STEP_HINT, type ReportNode } from "../../../engines/report";
import { defineReactNodeView, type ReactNodeViewComponent } from "prosekit/react";
import { hljsParser } from "./codeHighlight";
import { addStep, moveCell } from "./commands";
import { CodeBlockView } from "./nodes/CodeBlockView";
import { defineGuideNotes, GuideSlots } from "./GuideNote";
import { EvidenceView } from "./nodes/EvidenceView";
import { ExploitView } from "./nodes/ExploitView";
import { GeneratedView } from "./nodes/GeneratedView";
import { PhaseView } from "./nodes/PhaseView";
import { SlotView } from "./nodes/SlotView";
import { STEP_NUMBER, StepsView, StepView } from "./nodes/StepsView";
import { VulnView } from "./nodes/VulnView";

/** The atom blocks the page is built from, with their attribute defaults (types.ts holds the contract). */
const ATOMS: { name: string; attrs: Record<string, unknown>; component: ReactNodeViewComponent }[] = [
  { name: "phase", attrs: { phase: "foothold", hostId: "", findingId: null }, component: PhaseView },
  {
    name: "evidence",
    attrs: { entryId: "", block: null, keep: null, emphasis: [], appendix: "inline", caption: null, width: null },
    component: EvidenceView,
  },
  { name: "generated", attrs: { kind: "facts", hostId: null, appendix: "inline", notes: {} }, component: GeneratedView },
  { name: "vuln", attrs: { findingId: "" }, component: VulnView },
  { name: "exploit", attrs: { fileId: "", markedLines: [], appendix: "inline" }, component: ExploitView },
];

/** Clicks and typing in controls inside a node view (line-number toggles, a caption, the Tools appendix's fields) stay
 *  with the control, not ProseMirror. */
const stopControlEvents = (event: Event) => event.target instanceof Element && event.target.closest("button, input, textarea, [role=combobox], [data-trim]") !== null;

/** Atoms serialise their attrs so copy and paste between positions keeps them. */
function atomSpec(name: string, defaults: Record<string, unknown>) {
  return defineNodeSpec({
    name,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,
    attrs: Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, { default: v }])),
    parseDOM: [
      {
        tag: `div[data-report="${name}"]`,
        getAttrs: (dom: HTMLElement) => {
          try {
            return JSON.parse(dom.getAttribute("data-attrs") ?? "{}") as Record<string, unknown>;
          } catch {
            return false;
          }
        },
      },
    ],
    toDOM: (node: PMNode) => ["div", { "data-report": name, "data-attrs": JSON.stringify(node.attrs) }],
  });
}

const slotSpec = defineNodeSpec({
  name: "slot",
  group: "block",
  content: "inline*",
  attrs: { hint: { default: "" }, label: { default: "" } },
  parseDOM: [
    {
      tag: "p[data-report=slot]",
      getAttrs: (dom: HTMLElement) => ({ hint: dom.getAttribute("data-hint") ?? "", label: dom.getAttribute("data-label") ?? "" }),
    },
  ],
  toDOM: (node: PMNode) => ["p", { "data-report": "slot", "data-hint": node.attrs.hint as string, "data-label": node.attrs.label as string }, 0],
});

/** A numbered Steps to reproduce list (§10.2). Never empty: deleting its last step deletes the list (ProseMirror's
 *  deleteRange widens to the parent a deletion would leave invalid). */
const stepsSpec = defineNodeSpec({
  name: "steps",
  group: "block",
  content: "step+",
  parseDOM: [{ tag: 'div[data-report="steps"]' }],
  toDOM: () => ["div", { "data-report": "steps" }, 0],
});

/** One step: the owner's sentence (a slot until written, or paragraphs), then its evidence. Dragged by its number. */
const stepSpec = defineNodeSpec({
  name: "step",
  content: "(slot | paragraph) block*",
  attrs: { entryId: { default: null } },
  defining: true,
  draggable: true,
  parseDOM: [
    {
      tag: 'div[data-report="step"]',
      getAttrs: (dom: HTMLElement) => {
        try {
          return JSON.parse(dom.getAttribute("data-attrs") ?? "{}") as Record<string, unknown>;
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (node: PMNode) => ["div", { "data-report": "step", "data-attrs": JSON.stringify(node.attrs) }, 0],
});

/** Gives each step its number in its list (from 1, again in every list), which its view prints: a decoration, so the
 *  numbers follow every insertion, removal and move. */
const stepNumbers = definePlugin(
  new Plugin({
    props: {
      decorations: (state) => {
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "steps") return true;
          node.forEach((step, offset, i) => {
            const from = pos + 1 + offset;
            decos.push(Decoration.node(from, from + step.nodeSize, {}, { [STEP_NUMBER]: i + 1 }));
          });
          return true;
        });
        return decos.length === 0 ? null : DecorationSet.create(state.doc, decos);
      },
    },
  }),
);

/**
 * A step whose sentence goes while evidence stays (its text deleted up to the chip) is refilled by ProseMirror with a
 * default slot, whose hint is empty: it takes the step's hint, so the owner still sees what to write there.
 */
const stepHints = definePlugin(
  new Plugin({
    appendTransaction: (trs, _old, state) => {
      if (!trs.some((tr) => tr.docChanged)) return null;
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "step") return !node.isTextblock && !node.isAtom;
        const first = node.firstChild;
        if (first?.type.name === "slot" && first.attrs.hint === "") tr.setNodeMarkup(pos + 1, undefined, { ...first.attrs, hint: STEP_HINT });
        return false;
      });
      return tr.docChanged ? tr : null;
    },
  }),
);

/** ⌘⇧↵ adds a step. */
const stepsKeymap = defineKeymap({ "Mod-Shift-Enter": addStep() });

/** The log entry a block's text came from (a note, observations, a command edited on the page): provenance only. */
const fromEntryAttr = (type: string) =>
  defineNodeAttr({
    type,
    attr: "fromEntry",
    default: null,
    toDOM: (value: string | null) => (value ? ["data-from-entry", value] : null),
    parseDOM: (dom: HTMLElement) => dom.getAttribute("data-from-entry"),
  });

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
            const from = node.attrs.fromEntry as unknown;
            if (typeof from !== "string" || from === "") return true;
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

/** What an empty block says while the cursor is in it. A slot shows its own hint, so it takes none here. */
function placeholderFor(state: EditorState): string {
  const parent = state.selection.$from.parent;
  if (parent.type.name === "slot") return "";
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

/** The report page's schema and node views: the editing set plus Raven's report vocabulary. */
export function defineReportExtension(
  numbers: SubNumbers = { current: undefined },
  held: HeldPositions = new Set(),
  gone: SourceGone = { current: undefined },
  guides: GuideSlots = new GuideSlots(),
): Extension {
  return union(
    headingNumbers(numbers),
    defineGuideNotes(guides),
    sourceGoneMarks(gone),
    holdPositions(held),
    defineEditing(numbers),
    activeCodeBlock,
    fromEntryAttr("paragraph"),
    defineNodeAttr({
      type: "paragraph",
      attr: "fromField",
      default: null,
      toDOM: (value: string | null) => (value ? ["data-from-field", value] : null),
      parseDOM: (dom: HTMLElement) => dom.getAttribute("data-from-field"),
    }),
    fromEntryAttr("codeBlock"),
    defineReactNodeView({ name: "codeBlock", component: CodeBlockView, as: "div", contentAs: "code", stopEvent: stopControlEvents }),
    slotSpec,
    defineReactNodeView({ name: "slot", component: SlotView, as: "div", contentAs: "div" }),
    stepsSpec,
    stepSpec,
    stepNumbers,
    stepHints,
    stepsKeymap,
    defineReactNodeView({ name: "steps", component: StepsView, as: "div", contentAs: "div", stopEvent: stopControlEvents }),
    defineReactNodeView({ name: "step", component: StepView, as: "div", contentAs: "div" }),
    ...ATOMS.flatMap(({ name, attrs, component }) => [
      atomSpec(name, attrs),
      defineReactNodeView({ name, component, as: "div", stopEvent: stopControlEvents }),
    ]),
  );
}
