import type { LogEntry } from "../../types/log";
import { ADDITIONAL_HEADING, ENUM_HEADING, entryBlocks, PHASE_TITLE, PLAIN_NODE_TYPES, sourceBlocks, TESTED_HEADING } from "./plain";
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

/** One command of a copy and the output it printed; `at` is its block in the entry, `offset` the output's first line in
 *  the copy (`keep` indexes the copy's joined output). */
interface Segment {
  command: string;
  output: string;
  at: number;
  offset: number;
}
type FlagText = { value: string; proof: string };
type EvidenceText = { segments: Segment[] } | FlagText;

const lines = (s: string) => s.split(/\r?\n/).length;
const asText = (v: unknown) => (typeof v === "string" ? v : "");

/** The log's full text of an evidence block (no length cap): a command entry's blocks (one, or all of them), an HTTP
 *  entry's request and response, a flag's value and proof. Null for any other entry. */
function logText(entry: LogEntry, block: number | null): EvidenceText | null {
  const c = entry.content;
  if (c.kind === "command") {
    const picked = block === null ? c.blocks.map((b, at) => ({ b, at })) : c.blocks[block] ? [{ b: c.blocks[block], at: block }] : [];
    let offset = 0;
    return {
      segments: picked.map(({ b, at }) => {
        const seg = { command: b.command ?? "", output: b.output ?? "", at, offset };
        offset += lines(seg.output);
        return seg;
      }),
    };
  }
  if (c.kind === "http") return { segments: [{ command: c.request ?? "", output: c.response ?? "", at: 0, offset: 0 }] };
  if (c.kind === "flag") return { value: c.value ?? "", proof: c.proof ?? "" };
  return null;
}

/** A stored copy's text. A whole multi-block command entry's copy (`block` null) is split back into its blocks by the
 *  log's line counts, so each command sits above its own output; when the owner changed the line counts it stays one
 *  command and one output. */
function copyText(copy: Record<string, unknown>, block: number | null, entry: LogEntry | undefined): EvidenceText {
  if ("value" in copy) return { value: asText(copy.value), proof: asText(copy.proof) };
  const command = asText(copy.command);
  const output = asText(copy.output);
  const blocks = entry?.content.kind === "command" ? entry.content.blocks : [];
  if (block === null && blocks.length > 1) {
    const commandLines = command.split(/\r?\n/);
    const outputLines = output.split(/\r?\n/);
    const counts = blocks.map((b) => [lines(b.command ?? ""), lines(b.output ?? "")]);
    if (counts.reduce((n, [c]) => n + c, 0) === commandLines.length && counts.reduce((n, [, o]) => n + o, 0) === outputLines.length) {
      let ci = 0;
      let oi = 0;
      return {
        segments: counts.map(([c, o], at) => {
          const seg = { command: commandLines.slice(ci, ci + c).join("\n"), output: outputLines.slice(oi, oi + o).join("\n"), at, offset: oi };
          ci += c;
          oi += o;
          return seg;
        }),
      };
    }
  }
  return { segments: [{ command, output, at: block ?? 0, offset: 0 }] };
}

/** `keep` ranges moved to a segment whose output starts `offset` lines into the copy. */
const shiftKeep = (keep: unknown, offset: number): [number, number][] | null =>
  Array.isArray(keep) ? (keep as [number, number][]).map(([a, b]) => [a - offset, b - offset] as [number, number]) : null;

/** An evidence block's text as code blocks: each command above its output (kept ranges applied unless `full`), a flag's
 *  proof, and its value when the proof does not hold it. */
function textBlocks(t: EvidenceText, entryId: string, http: boolean, keep: unknown, full: boolean): ReportNode[] {
  const trimEnd = (s: string) => s.replace(/\s+$/, "");
  if ("value" in t) {
    const out: ReportNode[] = [];
    const proof = trimEnd(t.proof);
    const value = t.value.trim();
    if (proof.trim() !== "") out.push(codeBlock(proof, `entry:${entryId}:proof`));
    if (value !== "" && !proof.includes(value)) out.push(codeBlock(value, `entry:${entryId}:value`));
    return out;
  }
  return t.segments.flatMap((seg) => {
    const out: ReportNode[] = [];
    const command = trimEnd(seg.command);
    if (command.trim() !== "") out.push(codeBlock(command, http ? `entry:${entryId}:request` : `entry:${entryId}:${seg.at}:command`));
    const output = full ? trimEnd(seg.output) : keptOutput(seg.output, shiftKeep(keep, seg.offset));
    if (output.trim() !== "") out.push(codeBlock(output, http ? `entry:${entryId}:response` : `entry:${entryId}:${seg.at}:output`));
    return out;
  });
}

const figure = (attachmentId: string, caption: string, entryId: string, width: unknown = null): ReportNode => ({
  type: "figure",
  attrs: { attachmentId, entryId, source: `entry:${entryId}`, ...(typeof width === "number" && width > 0 ? { width: Math.round(width) } : {}) },
  ...(caption.trim() ? { content: [text(caption.trim())] } : {}),
});

/**
 * An evidence block: a screenshot as a figure; its copy as code blocks (the log's full text when the copy was cut, the
 * whole output when the block was split to an appendix), a flag's picture as a figure after it; a copy-less block from
 * the log. An entry now private is not printed (the page before the flatten keeps it).
 */
function evidence(n: ReportNode, ctx: Ctx): ReportNode[] {
  const attrs = n.attrs ?? {};
  const entryId = str(attrs.entryId) ?? "";
  const block = typeof attrs.block === "number" ? attrs.block : null;
  const entry = entryId ? ctx.data?.log.find((l) => l.id === entryId) : undefined;
  if (entry?.private) return [];
  const caption = typeof attrs.caption === "string" ? attrs.caption : null;
  const copy = attrs.copy && typeof attrs.copy === "object" ? (attrs.copy as Record<string, unknown>) : null;
  const full = attrs.appendix === "split";
  const http = entry?.content.kind === "http";

  if (entry?.content.kind === "screenshot") {
    const c = entry.content;
    return [figure(c.attachmentId, caption ?? (c.caption.trim() || entry.title), entry.id, attrs.width)];
  }
  const flagPicture = (): ReportNode[] =>
    entry?.content.kind === "flag" && entry.content.attachmentId ? [figure(entry.content.attachmentId, caption ?? `${entry.content.flagKind}.txt`, entry.id)] : [];

  if (copy) {
    const fromLog = attrs.truncated === true && entry ? logText(entry, block) : null;
    return [...textBlocks(fromLog ?? copyText(copy, block, entry), entryId, http, attrs.keep, full), ...flagPicture()];
  }
  if (entry && full) {
    const t = logText(entry, block);
    if (t) return [...textBlocks(t, entryId, http, null, true), ...flagPicture()];
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
  // The entry is gone: only the owner's caption is kept.
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

/** Phase headings worded as the plain draft writes them, so a flattened page reads like a rebuilt one. */
const PHASE_HEADINGS: Partial<Record<Phase, string>> = { ...PHASE_TITLE, enum: ENUM_HEADING, additional: ADDITIONAL_HEADING, tested: TESTED_HEADING };

/** A phase heading in the sample's wording, a finding's own one named after it. */
function phase(n: ReportNode, ctx: Ctx): ReportNode[] {
  const p = str(n.attrs?.phase) ?? "";
  const hostId = str(n.attrs?.hostId) ?? "";
  const findingId = str(n.attrs?.findingId);
  const title = PHASE_HEADINGS[p as Phase] ?? p;
  const named = findingId ? ctx.data?.findings.find((f) => f.id === findingId)?.title.trim() : undefined;
  const source = `phase:${hostId}:${p}${findingId ? `:${findingId}` : ""}`;
  // A finding's own heading under Additional findings is its title, one level down; elsewhere the phase names it.
  if (named && p === "additional") return [{ type: "heading", attrs: { level: 3, source }, content: [text(named)] }];
  return [{ type: "heading", attrs: { level: 2, source }, content: [text(named ? `${title}: ${named}` : title)] }];
}

/** A slot: its text as a paragraph (its label a bold lead-in), or an empty one with its hint. */
function slot(n: ReportNode, ctx: Ctx): ReportNode[] {
  const content = (n.content ?? []).flatMap((c) => flat(c, ctx));
  if (content.length === 0) {
    const hint = str(n.attrs?.hint);
    return [hint ? hintPara(hint) : para([])];
  }
  const label = str(n.attrs?.label);
  return [para(label ? [bold(label), text(" "), ...content] : content)];
}

/** The containers the schema requires to hold a block: emptied by the flatten (every child a private entry's copy), each
 *  keeps one empty paragraph. */
const NEEDS_BLOCK = ["doc", "list", "blockquote", "tableCell", "tableHeaderCell"];

/** A block of the page's own schema: kept, its children flattened (a required block put back, `NEEDS_BLOCK`);
 *  `fromEntry` turned into a source. */
function own(n: ReportNode, ctx: Ctx): ReportNode {
  let attrs = n.attrs;
  if (attrs && ("fromEntry" in attrs || "fromField" in attrs)) {
    const { fromEntry, fromField, ...rest } = attrs;
    const id = str(fromEntry);
    if (id && !sourceOf(n)) rest.source = fromField === "observations" ? `entry:${id}:observations` : `entry:${id}:note`;
    attrs = Object.keys(rest).length > 0 ? rest : undefined;
  }
  let content = n.content?.flatMap((c) => flat(c, ctx));
  if (content?.length === 0 && NEEDS_BLOCK.includes(n.type)) content = [para([])];
  const out: ReportNode = { ...n, ...(content ? { content } : {}) };
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
      return slot(n, ctx);
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
  return own(structuredClone(doc), { data, target, meta });
}
