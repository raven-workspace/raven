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
  union,
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
import { defineTextBlockInputRule } from "prosekit/extensions/input-rule";
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
import { Plugin, type EditorState } from "prosekit/pm/state";
import { Decoration, DecorationSet } from "prosekit/pm/view";
import type { ReportNode } from "../../../engines/report";
import { defineReactNodeView, type ReactNodeViewComponent } from "prosekit/react";
import { hljsParser } from "./codeHighlight";
import { moveCell } from "./commands";
import { CodeBlockView } from "./nodes/CodeBlockView";
import { EvidenceView } from "./nodes/EvidenceView";
import { ExploitView } from "./nodes/ExploitView";
import { GeneratedView } from "./nodes/GeneratedView";
import { PhaseView } from "./nodes/PhaseView";
import { SlotView } from "./nodes/SlotView";
import { VulnView } from "./nodes/VulnView";

/** The atom blocks the page is built from, with their attribute defaults (types.ts holds the contract). */
const ATOMS: { name: string; attrs: Record<string, unknown>; component: ReactNodeViewComponent }[] = [
  { name: "phase", attrs: { phase: "foothold", hostId: "" }, component: PhaseView },
  {
    name: "evidence",
    attrs: { entryId: "", block: null, keep: null, emphasis: [], appendix: "inline", caption: null, width: null },
    component: EvidenceView,
  },
  { name: "generated", attrs: { kind: "facts", hostId: null, appendix: "inline" }, component: GeneratedView },
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

/** The owner's headings: `# `, `## ` and `### ` at a line's start (they stay unnumbered: only the drafted structure
 *  takes numbers). */
const headingRule = defineTextBlockInputRule({ regex: /^(#{1,3})\s$/, type: "heading", attrs: (match) => ({ level: match[1]?.length ?? 1 }) });

/** The page's keys beyond ProseKit's own: headings 1 to 3, paragraph, sub- and superscript. */
const pageKeymap = defineKeymap({
  "Mod-Alt-0": withSkipCodeBlock(setBlockType({ type: "paragraph" })),
  "Mod-Alt-1": withSkipCodeBlock(toggleNode({ type: "heading", attrs: { level: 1 } })),
  "Mod-Alt-2": withSkipCodeBlock(toggleNode({ type: "heading", attrs: { level: 2 } })),
  "Mod-Alt-3": withSkipCodeBlock(toggleNode({ type: "heading", attrs: { level: 3 } })),
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
function defineEditing() {
  return union(
    defineDoc(),
    defineText(),
    defineParagraph(),
    defineHeadingSpec(),
    defineHeadingCommands(),
    headingRule,
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
    pageKeymap,
  );
}

/** The editing set's typed commands, marks and nodes, for the page's chrome (`useEditor<EditingExtension>`). */
export type EditingExtension = ReturnType<typeof defineEditing>;

/** The report page's schema and node views: the editing set plus Raven's report vocabulary. */
export function defineReportExtension(numbers: SubNumbers = { current: undefined }): Extension {
  return union(
    headingNumbers(numbers),
    defineEditing(),
    activeCodeBlock,
    fromEntryAttr("paragraph"),
    fromEntryAttr("codeBlock"),
    defineReactNodeView({ name: "codeBlock", component: CodeBlockView, as: "div", contentAs: "code", stopEvent: stopControlEvents }),
    slotSpec,
    defineReactNodeView({ name: "slot", component: SlotView, as: "div", contentAs: "div" }),
    ...ATOMS.flatMap(({ name, attrs, component }) => [
      atomSpec(name, attrs),
      defineReactNodeView({ name, component, as: "div", stopEvent: stopControlEvents }),
    ]),
  );
}
