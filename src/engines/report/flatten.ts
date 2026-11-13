import type { LogEntry } from "../../types/log";
import { PHASE_TITLES } from "./headings";
import { entryBlocks, PLAIN_NODE_TYPES, sourceBlocks } from "./plain";
import { hintPara, msfLine, plainTable, type PlainTableKind } from "./plainTables";
import { sourceOf } from "./stamp";
import { portRows } from "./tables";
import { applyKeep } from "./trim";
import type { Phase, ReportData, ReportMeta, ReportNode, ReportTarget } from "./types";

/**
 * Any stored page (layouts 3 to 5, and owner pages written with the old container and atom nodes) as a plain page
 * (`buildPlainTarget`'s schema): steps become numbered list items, slots paragraphs, phases headings, evidence and
 * exploit copies code blocks, screenshots figures, table copies their tables. Every word the owner typed is kept: a
 * slot's text, an edited finding or table copy, a port note, a screenshot caption. Blocks it writes carry a `source`
 * but no `gen`, so Refresh treats them as edited and asks before replacing them.
 */

/** The node types a page holds: the plain draft's, plus the owner's own quote and rule. */
export const PAGE_NODE_TYPES: readonly string[] = [...PLAIN_NODE_TYPES, "blockquote", "horizontalRule"];

/** Whether a page holds any node outside `PAGE_NODE_TYPES`. */
export function needsFlatten(doc: ReportNode): boolean {
  const walk = (n: ReportNode): boolean => !PAGE_NODE_TYPES.includes(n.type) || (n.content ?? []).some(walk);
  return walk(doc);
}

const text = (value: string): ReportNode => ({ type: "text", text: value });
const bold = (value: string): ReportNode => ({ type: "text", text: value, marks: [{ type: "bold" }] });
const para = (content: ReportNode[]): ReportNode => (content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" });
const codeBlock = (value: string, source: string, language = ""): ReportNode => ({ type: "codeBlock", attrs: { language, source }, content: [text(value)] });
const omitted = (count: number) => `[… ${count} ${count === 1 ? "line" : "lines"} omitted …]`;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Blocks the engine generated, without their `gen` stamps (at any depth). */
const unstamped = (blocks: ReportNode[]): ReportNode[] =>
  blocks.map((b) => {
    const attrs = b.attrs ? Object.fromEntries(Object.entries(b.attrs).filter(([k]) => k !== "gen")) : undefined;
    return { ...b, ...(attrs ? { attrs } : {}), ...(b.content ? { content: unstamped(b.content) } : {}) };
  });

/** Each top-level block with `source` set. */
const sourced = (blocks: ReportNode[], source: string): ReportNode[] => blocks.map((b) => ({ ...b, attrs: { ...(b.attrs ?? {}), source } }));

/** A kept output as the page prints it: the kept ranges' lines, each gap one "[… N lines omitted …]" line. */
function keptOutput(output: string, keep: unknown): string {
  const ranges = Array.isArray(keep) ? (keep as [number, number][]) : null;
  return applyKeep(output, ranges)
    .map((item) => (item.kind === "line" ? item.text : omitted(item.count)))
    .join("\n")
    .replace(/\s+$/, "");
}

interface Ctx {
  data?: ReportData;
  target: ReportTarget | null;
  meta: ReportMeta;
}

/** The entry an evidence or note names, when the data holds it and it may be printed (not private). */
const entryOf = (ctx: Ctx, id: string | null): LogEntry | undefined => {
  const e = id ? ctx.data?.log.find((l) => l.id === id) : undefined;
  return e && !e.private ? e : undefined;
};

/** An evidence block: its copy as code blocks, a screenshot as a figure, a copy-less block from the log. */
function evidence(n: ReportNode, ctx: Ctx): ReportNode[] {
  const attrs = n.attrs ?? {};
  const entryId = str(attrs.entryId) ?? "";
  const block = typeof attrs.block === "number" ? attrs.block : null;
  const entry = entryOf(ctx, entryId);
  const caption = typeof attrs.caption === "string" ? attrs.caption : null;
  const copy = attrs.copy as Record<string, unknown> | null | undefined;

  if (entry?.content.kind === "screenshot") {
    const c = entry.content;
    const words = (caption ?? (c.caption.trim() || entry.title)).trim();
    return [{ type: "figure", attrs: { attachmentId: c.attachmentId, entryId: entry.id, source: `entry:${entry.id}` }, ...(words ? { content: [text(words)] } : {}) }];
  }
  if (copy && typeof copy === "object") {
    if ("value" in copy) {
      const proof = typeof copy.proof === "string" ? copy.proof.replace(/\s+$/, "") : "";
      const value = typeof copy.value === "string" ? copy.value.trim() : "";
      if (proof.trim() !== "") return [codeBlock(proof, `entry:${entryId}:proof`)];
      return value !== "" ? [codeBlock(value, `entry:${entryId}:value`)] : [];
    }
    const http = entry?.content.kind === "http";
    const at = block ?? 0;
    const out: ReportNode[] = [];
    const command = typeof copy.command === "string" ? copy.command.replace(/\s+$/, "") : "";
    if (command.trim() !== "") out.push(codeBlock(command, http ? `entry:${entryId}:request` : `entry:${entryId}:${at}:command`));
    const output = typeof copy.output === "string" ? keptOutput(copy.output, attrs.keep) : "";
    if (output.trim() !== "") out.push(codeBlock(output, http ? `entry:${entryId}:response` : `entry:${entryId}:${at}:output`));
    return out;
  }
  if (entry && ctx.data) {
    // The entry's blocks as a draft step holds them, its sentence left out (the step has the owner's); a block of a
    // command entry only its own command and output.
    const blocks = entryBlocks(ctx.data, entry).filter((b) => {
      const source = sourceOf(b) ?? "";
      if (source.endsWith(":title") || source.endsWith(":observations")) return false;
      if (block === null || entry.content.kind !== "command") return true;
      const m = /:(\d+):(?:command|output)$/.exec(source);
      return m ? Number(m[1]) === block : false;
    });
    return unstamped(blocks);
  }
  // The entry is gone or private: only the owner's caption is kept.
  return caption?.trim() ? [para([text(caption.trim())])] : [];
}

/** A Notes column the owner typed (service id → text), as paragraphs. */
const notesParagraphs = (notes: string[]): ReportNode[] => notes.filter((t) => t.trim() !== "").map((t) => para([text(t)]));

/** A layout-4 port table, rebuilt from the data with the owner's Notes written into its Notes cells. Notes for a port no
 *  longer on the table follow it as paragraphs. */
function portsWithNotes(hostId: string, notes: Record<string, string>, ctx: Ctx & { data: ReportData }): ReportNode[] {
  const blocks = unstamped(sourceBlocks(`ports:${hostId}`, ctx.data, ctx.target, ctx.meta) ?? []);
  const rows = portRows(ctx.data, hostId);
  const placed = new Set<string>();
  const filled = blocks.map((b) => {
    if (b.type !== "table") return b;
    const content = (b.content ?? []).map((row, i) => {
      const note = i > 0 ? notes[rows[i - 1]?.serviceId ?? ""] : undefined;
      if (!note?.trim()) return row;
      placed.add(rows[i - 1].serviceId);
      const cells = [...(row.content ?? [])];
      cells[3] = { ...cells[3], content: [para([text(note)])] };
      return { ...row, content: cells };
    });
    return { ...b, content };
  });
  return [...filled, ...notesParagraphs(Object.entries(notes).filter(([id]) => !placed.has(id)).map(([, t]) => t))];
}

/** A live generated block, rendered from the data as the plain draft writes it. Without data it is dropped (a port
 *  table's typed Notes kept as paragraphs). */
function generated(n: ReportNode, ctx: Ctx): ReportNode[] {
  const kind = str(n.attrs?.kind);
  const hostId = str(n.attrs?.hostId);
  const notes = (n.attrs?.notes && typeof n.attrs.notes === "object" ? n.attrs.notes : {}) as Record<string, string>;
  const { data } = ctx;
  if (!data) return kind === "ports" || kind === "port-scan" ? notesParagraphs(Object.values(notes)) : [];
  const from = (source: string) => unstamped(sourceBlocks(source, data, ctx.target, ctx.meta) ?? []);
  const table = (k: PlainTableKind) => unstamped(plainTable(k, data, ctx.meta));
  switch (kind) {
    case "facts":
    case "result":
      return hostId ? from(`${kind}:${hostId}`) : [];
    case "ports":
    case "port-scan":
      return hostId ? portsWithNotes(hostId, notes, { ...ctx, data }) : notesParagraphs(Object.values(notes));
    case "tested":
      return hostId ? from(`tested:${hostId}`) : table("tested");
    case "attack-path":
    case "attack-chain":
      return from("attack-path");
    case "msf":
      return unstamped([msfLine(data)]);
    case "scope":
    case "scope-table":
      return table("scope-table");
    case "findings":
    case "cleanup":
    case "references":
      return table(kind);
    default:
      return [];
  }
}

/** A table copy's blocks, each with the source Refresh regenerates it from. */
function tableBlock(n: ReportNode, ctx: Ctx): ReportNode[] {
  const kind = str(n.attrs?.kind) ?? "";
  const hostId = str(n.attrs?.hostId);
  const source =
    (kind === "ports" || kind === "result" || kind === "tested") && hostId ? `${kind}:${hostId}` : kind === "attack-path" ? "attack-path" : `table:${kind}`;
  return sourced((n.content ?? []).flatMap((c) => flat(c, ctx)), source);
}

/** A layout-4 finding: its labelled lines as the plain draft writes them. The exploit code is its own block. */
function vuln(n: ReportNode, ctx: Ctx): ReportNode[] {
  const id = str(n.attrs?.findingId);
  const { data } = ctx;
  if (!id || !data) return [];
  return ["explanation", "fix", "severity", "affected", "exploit"].flatMap((part) =>
    unstamped(sourceBlocks(`finding:${id}:${part}`, data, ctx.target, ctx.meta) ?? []),
  );
}

/** An exploit block: its copy (or, with none, the finding file) as a code block. */
function exploit(n: ReportNode, ctx: Ctx): ReportNode[] {
  const fileId = str(n.attrs?.fileId) ?? "";
  const file = ctx.data?.findingFiles.find((f) => f.id === fileId);
  const copy = n.attrs?.copy as { content?: unknown } | undefined;
  const content = typeof copy?.content === "string" ? copy.content : (file?.content ?? "");
  const code = content.replace(/\s+$/, "");
  return code.trim() !== "" ? [codeBlock(code, `file:${fileId}`, file?.language ?? "")] : [];
}

/** A phase heading in the sample's wording, a finding's own one named after it. */
function phase(n: ReportNode, ctx: Ctx): ReportNode[] {
  const p = str(n.attrs?.phase) ?? "";
  const hostId = str(n.attrs?.hostId) ?? "";
  const findingId = str(n.attrs?.findingId);
  const title = PHASE_TITLES[p as Phase] ?? p;
  const finding = findingId ? ctx.data?.findings.find((f) => f.id === findingId) : undefined;
  const words = finding?.title.trim() ? `${title} – ${finding.title.trim()}` : title;
  return [{ type: "heading", attrs: { level: 2, source: `phase:${hostId}:${p}${findingId ? `:${findingId}` : ""}` }, content: [text(words)] }];
}

/** A slot: its text as a paragraph (its label a bold lead-in), or an empty one with its hint. */
function slot(n: ReportNode): ReportNode[] {
  const content = n.content ?? [];
  if (content.length === 0) {
    const hint = str(n.attrs?.hint);
    return [hint ? hintPara(hint) : para([])];
  }
  const label = str(n.attrs?.label);
  return [para(label ? [bold(label), text(" "), ...content] : content)];
}

/** A block of the page's own schema: kept, its children flattened; `fromEntry` turned into a source. */
function own(n: ReportNode, ctx: Ctx): ReportNode {
  let attrs = n.attrs;
  if (attrs && ("fromEntry" in attrs || "fromField" in attrs)) {
    const { fromEntry, fromField, ...rest } = attrs;
    const id = str(fromEntry);
    if (id && !sourceOf(n)) rest.source = fromField === "observations" ? `entry:${id}:observations` : `entry:${id}:note`;
    attrs = Object.keys(rest).length > 0 ? rest : undefined;
  }
  const out: ReportNode = { ...n, ...(n.content ? { content: n.content.flatMap((c) => flat(c, ctx)) } : {}) };
  if (attrs) out.attrs = attrs;
  else delete out.attrs;
  return out;
}

function flat(n: ReportNode, ctx: Ctx): ReportNode[] {
  if (n.type === "text") return [n];
  if (PAGE_NODE_TYPES.includes(n.type)) return [own(n, ctx)];
  switch (n.type) {
    case "steps":
      return (n.content ?? []).flatMap((s) => {
        if (s.type !== "step") return flat(s, ctx);
        const content = (s.content ?? []).flatMap((c) => flat(c, ctx));
        return [{ type: "list", attrs: { kind: "ordered" }, content: content.length > 0 ? content : [para([])] }];
      });
    case "slot":
      return slot(n);
    case "phase":
      return phase(n, ctx);
    case "evidence":
      return evidence(n, ctx);
    case "table-block":
      return tableBlock(n, ctx);
    case "generated":
      return generated(n, ctx);
    case "vuln":
      return vuln(n, ctx);
    case "exploit":
      return exploit(n, ctx);
    default:
      // `step`, `finding` and any other container: its children; an unknown atom has nothing to keep.
      return (n.content ?? []).flatMap((c) => flat(c, ctx));
  }
}

/**
 * A stored page in the plain schema (`PAGE_NODE_TYPES`), every word the owner typed kept. Pure and idempotent: a page
 * already plain comes back deep-equal. `data` renders what the page held only as a reference (a layout-4 evidence block,
 * a live table, a phase's finding title); without it those blocks are dropped. No block it writes carries `gen`.
 */
export function flattenToPlain(doc: ReportNode, data?: ReportData, target: ReportTarget | null = null, meta: ReportMeta = {}): ReportNode {
  return own(doc, { data, target, meta });
}
