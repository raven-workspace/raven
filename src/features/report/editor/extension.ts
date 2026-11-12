import { defineBasicExtension } from "prosekit/basic";
import { defineNodeSpec, union, type Extension } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { defineReactNodeView, type ReactNodeViewComponent } from "prosekit/react";
import { EvidenceView } from "./nodes/EvidenceView";
import { ExploitView } from "./nodes/ExploitView";
import { GeneratedView } from "./nodes/GeneratedView";
import { PhaseView } from "./nodes/PhaseView";
import { SlotView } from "./nodes/SlotView";
import { VulnView } from "./nodes/VulnView";

/** The atom blocks the page is built from, with their attribute defaults (types.ts holds the contract). */
const ATOMS: { name: string; attrs: Record<string, unknown>; component: ReactNodeViewComponent }[] = [
  { name: "phase", attrs: { phase: "foothold", hostId: "" }, component: PhaseView },
  { name: "evidence", attrs: { entryId: "", block: null, keep: null, emphasis: [], appendix: "inline" }, component: EvidenceView },
  { name: "generated", attrs: { kind: "facts", hostId: null, appendix: "inline" }, component: GeneratedView },
  { name: "vuln", attrs: { findingId: "" }, component: VulnView },
  { name: "exploit", attrs: { fileId: "", markedLines: [], appendix: "inline" }, component: ExploitView },
];

/** Clicks and typing in controls inside a node view (line-number toggles, the Tools appendix's fields) stay with the control, not ProseMirror. */
const stopControlEvents = (event: Event) => event.target instanceof Element && event.target.closest("button, input") !== null;

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

/** The report page's schema and node views: ProseKit's basic editing (history included; a second defineHistory throws) plus Raven's report vocabulary. */
export function defineReportExtension(): Extension {
  return union(
    defineBasicExtension(),
    slotSpec,
    defineReactNodeView({ name: "slot", component: SlotView, as: "div", contentAs: "div" }),
    ...ATOMS.flatMap(({ name, attrs, component }) => [
      atomSpec(name, attrs),
      defineReactNodeView({ name, component, as: "div", stopEvent: stopControlEvents }),
    ]),
  );
}
