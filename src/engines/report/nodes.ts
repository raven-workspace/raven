import type { ReportNode } from "./types";

/**
 * The ProseMirror nodes the report builders write, one builder each. Generated blocks are hashed (`blockHash`), so a
 * builder's JSON (keys and their order included) must not change: a change would make Refresh read every generated
 * block as owner-edited. An optional attr (`source`) is left out when not given, never written as undefined.
 */

export type Mark = { type: string; attrs?: Record<string, unknown> };

export const text = (value: string, marks: Mark[] = []): ReportNode => (marks.length > 0 ? { type: "text", text: value, marks } : { type: "text", text: value });
export const bold = (value: string) => text(value, [{ type: "bold" }]);
export const code = (value: string) => text(value, [{ type: "code" }]);

/** A paragraph; with no content, an empty one (no `content` key). */
export const para = (content: ReportNode[], source?: string): ReportNode => ({
  type: "paragraph",
  ...(source ? { attrs: { source } } : {}),
  ...(content.length > 0 ? { content } : {}),
});

export const heading = (level: number, value: string, source?: string): ReportNode => ({
  type: "heading",
  attrs: { level, ...(source ? { source } : {}) },
  content: [text(value)],
});

/** A code block. `bareWhenEmpty`: an empty one has no `content` key (finding text) rather than one empty text node. */
export const codeBlock = (value: string, opts: { language?: string; source?: string; bareWhenEmpty?: boolean } = {}): ReportNode => ({
  type: "codeBlock",
  attrs: { language: opts.language ?? "", ...(opts.source ? { source: opts.source } : {}) },
  ...(opts.bareWhenEmpty && value === "" ? {} : { content: [text(value)] }),
});

/** One item of a flat list: `blocks` are its content. */
export const listItem = (kind: "ordered" | "bullet", blocks: ReportNode[], source?: string): ReportNode => ({
  type: "list",
  attrs: { kind, ...(source ? { source } : {}) },
  content: blocks,
});

/** A screenshot with its editable caption (none when blank); `width` only when a positive number. */
export const figure = (attachmentId: string, caption: string, entryId: string, width: unknown = null): ReportNode => ({
  type: "figure",
  attrs: { attachmentId, entryId, source: `entry:${entryId}`, ...(typeof width === "number" && width > 0 ? { width: Math.round(width) } : {}) },
  ...(caption.trim() ? { content: [text(caption.trim())] } : {}),
});

export const doc = (content: ReportNode[]): ReportNode => ({ type: "doc", content });

/** A table: a header row, then body rows; each cell one paragraph of the given inline nodes. */
export function table(head: ReportNode[][], rows: ReportNode[][][], source?: string): ReportNode {
  const row = (cellType: string, cells: ReportNode[][]): ReportNode => ({
    type: "tableRow",
    content: cells.map((c) => ({ type: cellType, content: [para(c)] })),
  });
  return { type: "table", ...(source ? { attrs: { source } } : {}), content: [row("tableHeaderCell", head), ...rows.map((r) => row("tableCell", r))] };
}

/** A table of plain strings (`table`), an empty string an empty cell. */
export const textTable = (head: string[], rows: string[][], source?: string): ReportNode => {
  const cell = (value: string) => (value ? [text(value)] : []);
  return table(head.map(cell), rows.map((r) => r.map(cell)), source);
};

/** Top-level blocks with their source set (inner paragraphs of a list keep none). */
export const sourced = (blocks: ReportNode[], source: string): ReportNode[] => blocks.map((b) => ({ ...b, attrs: { ...(b.attrs ?? {}), source } }));

/** Text nodes in order, a neighbour with the same marks joined (as ProseMirror stores them) and empty ones dropped. */
export function joinText(nodes: ReportNode[]): ReportNode[] {
  const out: ReportNode[] = [];
  for (const n of nodes) {
    if (n.type === "text" && !n.text) continue;
    const last = out[out.length - 1];
    if (n.type === "text" && last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      out[out.length - 1] = { ...last, text: (last.text ?? "") + n.text };
    } else out.push(n);
  }
  return out;
}
