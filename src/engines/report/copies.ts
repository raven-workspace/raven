import { cells, parseInlineWith, TABLE_SEPARATOR, type Inline } from "../manual/markdown";
import type { Finding, FindingFile } from "../../types/findings";
import type { LogEntry } from "../../types/log";
import { testedLine, testedNotExploited } from "./coverage";
import { attackPathRows, findingRows, portRows, resultLine, scopeRows, type ResultLine } from "./tables";
import { reportTargets } from "./targets";
import { terminalBlocks } from "./terminal";
import {
  COPIED_KINDS,
  type AppendixPlacement,
  type CopiedKind,
  type EvidenceAttrs,
  type EvidenceCopy,
  type FindingCopyAttrs,
  type ReportData,
  type ReportMeta,
  type ReportNode,
  type ReportTarget,
  type TableBlockAttrs,
} from "./types";
import { fixSteps, splitAffected } from "./wording";

/**
 * Page-owned copies (§10.8): every block placed on the page is the page's own editable copy of its source (a finding,
 * a log entry, a finding file, a generated table). The source is never written; Refresh (`refreshNode`) replaces a
 * block with the source's current copy. Private or deleted sources are never copied.
 */

/** The most text one copied field holds (characters): a longer one keeps its start and says it was cut. */
export const COPY_LIMIT = 200 * 1024;

/** The Fix part's hint when the finding has no remediation; the page never prints "Not written yet". */
export const FIX_HINT = "How to fix it";
/** The Explanation part's hint when the finding has no description. */
export const EXPLANATION_HINT = "What the vulnerability is and why it exists";

type Mark = { type: string; attrs?: Record<string, unknown> };

const textNode = (text: string, marks: Mark[] = []): ReportNode => (marks.length > 0 ? { type: "text", text, marks } : { type: "text", text });
const bold = (text: string) => textNode(text, [{ type: "bold" }]);
const para = (content: ReportNode[]): ReportNode => (content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" });
const slotNode = (hint: string, label?: string): ReportNode => ({ type: "slot", attrs: label ? { hint, label } : { hint } });
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Text nodes in order, a neighbour with the same marks joined (as ProseMirror stores them) and empty ones dropped. */
function joinText(nodes: ReportNode[]): ReportNode[] {
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

/** Inline Markdown as text nodes: code, bold and italic as marks; a link reads as its label (with its URL when
 *  external), as the printed page has always shown it. */
function inlineNodes(parts: Inline[], marks: Mark[] = []): ReportNode[] {
  return parts.flatMap((p): ReportNode[] => {
    if ("text" in p) return [textNode(p.text, marks)];
    if ("code" in p) return [textNode(p.code, [...marks, { type: "code" }])];
    if ("strong" in p) return inlineNodes(p.strong, [...marks, { type: "bold" }]);
    if ("em" in p) return inlineNodes(p.em, [...marks, { type: "italic" }]);
    return [textNode(p.link.label, marks)];
  });
}

/** One line of finding text with its inline Markdown. */
export const inlineMarkdown = (text: string): ReportNode[] => joinText(inlineNodes(parseInlineWith(text, { urls: true })));
const inline = inlineMarkdown;

const codeBlock = (text: string): ReportNode =>
  text === "" ? { type: "codeBlock", attrs: { language: "" } } : { type: "codeBlock", attrs: { language: "" }, content: [{ type: "text", text }] };

const listItem = (kind: "bullet" | "ordered", content: ReportNode[]): ReportNode => ({ type: "list", attrs: { kind }, content: [para(content)] });

/** A table: a header row, then body rows; each cell one paragraph. */
function table(head: ReportNode[][], rows: ReportNode[][][]): ReportNode {
  const row = (cellType: string, cs: ReportNode[][]): ReportNode => ({
    type: "tableRow",
    content: cs.map((c) => ({ type: cellType, content: [para(joinText(c))] })),
  });
  return { type: "table", content: [row("tableHeaderCell", head), ...rows.map((r) => row("tableCell", r))] };
}
const plain = (text: string): ReportNode[] => (text === "" ? [] : [textNode(text)]);

const BULLET_ITEM = /^\s*[-*]\s(?=\S)(.*)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s(?=\S)(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/;
const isTableRow = (line: string) => line.trim().startsWith("|");

/**
 * A prose run as page blocks: paragraphs split on blank lines (wrapped lines joined), inline Markdown only. Two or more
 * `- item` (or `* item`, or `1. item`) lines in a row are a list; one alone stays a line of its own paragraph. A pipe
 * table is a table; a Markdown heading line reads as a bold paragraph.
 */
function proseBlocks(text: string): ReportNode[] {
  const lines = text.split("\n");
  const out: ReportNode[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      const content: ReportNode[] = [];
      paragraph.forEach((l, k) => {
        // A line that only looks like a list item keeps its own line; wrapped lines join with a space.
        if (k > 0) content.push(BULLET_ITEM.test(l) || ORDERED_ITEM.test(l) ? { type: "hardBreak" } : textNode(" "));
        content.push(...inline(l.trim()));
      });
      out.push(para(joinText(content)));
    }
    paragraph = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flush();
      const head = cells(line).map(inline);
      const rows: ReportNode[][][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]).map(inline));
        i++;
      }
      out.push(table(head, rows));
      continue;
    }
    const kind = BULLET_ITEM.test(line) ? "bullet" : ORDERED_ITEM.test(line) ? "ordered" : null;
    const itemRe = kind === "bullet" ? BULLET_ITEM : ORDERED_ITEM;
    if (kind && i + 1 < lines.length && itemRe.test(lines[i + 1])) {
      flush();
      while (i < lines.length && itemRe.test(lines[i])) {
        out.push(listItem(kind, inline(itemRe.exec(lines[i])![1].trim())));
        i++;
      }
      continue;
    }
    const h = HEADING.exec(line);
    if (h && paragraph.length === 0) {
      out.push(para(joinText(inlineNodes(parseInlineWith(h[1], { urls: true }), [{ type: "bold" }]))));
      i++;
      continue;
    }
    paragraph.push(line);
    i++;
  }
  flush();
  return out;
}

/** Finding text as page blocks: pasted terminal text as code blocks (`terminalBlocks`), the rest as prose. */
export function findingBlocks(text: string): ReportNode[] {
  return terminalBlocks(text).flatMap((run) => (run.kind === "code" ? [codeBlock(run.text)] : proseBlocks(run.text)));
}

/** A labelled part: the bold label leads the first paragraph; before a list, code or table it is a line of its own. */
export function labelled(label: string, blocks: ReportNode[]): ReportNode[] {
  const [first, ...rest] = blocks;
  if (first?.type === "paragraph") return [para(joinText([bold(label), textNode(" "), ...(first.content ?? [])])), ...rest];
  return [para([bold(label)]), ...blocks];
}

/** Whether a remediation is written as blocks (code, a table) rather than fix steps. */
const holdsBlocks = (text: string) =>
  terminalBlocks(text).some((r) => r.kind === "code") || text.split("\n").some((l, i, all) => isTableRow(l) && TABLE_SEPARATOR.test(all[i + 1] ?? ""));

/**
 * A finding as the page's own editable copy, in OffSec's sample order: Vulnerability Explanation (the description,
 * pasted terminal text as code), Vulnerability Fix (one bullet per fix step, or as written when it holds code or a
 * table; an empty one is a slot showing "How to fix it" in the editor only), Severity (with the CVSS vector), then the
 * "Affected: …" line the description opened with. `lessons` is private and never read.
 */
export function findingCopy(finding: Finding): ReportNode {
  const { affected, explanation } = splitAffected(finding.description ?? "");
  const remediation = (finding.remediation ?? "").trim();
  const expl = findingBlocks(explanation);
  const content: ReportNode[] = expl.length > 0 ? labelled("Vulnerability Explanation:", expl) : [slotNode(EXPLANATION_HINT, "Vulnerability Explanation:")];

  const FIX = "Vulnerability Fix:";
  if (remediation === "") content.push(slotNode(FIX_HINT, FIX));
  else if (holdsBlocks(remediation)) content.push(...labelled(FIX, findingBlocks(remediation)));
  else {
    const steps = fixSteps(remediation);
    if (steps.length > 1) content.push(para([bold(FIX)]), ...steps.map((s) => listItem("bullet", inline(s))));
    else content.push(...labelled(FIX, [para(inline(steps[0] ?? remediation))]));
  }

  const severity = finding.severity ? capitalize(finding.severity) : "Not rated";
  content.push(para([bold("Severity:"), textNode(` ${severity}${finding.cvssVector ? ` (${finding.cvssVector})` : ""}`)]));
  if (affected) content.push(...labelled("Affected:", [para(inline(affected))]));
  return { type: "finding", attrs: { findingId: finding.id, edited: false } satisfies FindingCopyAttrs, content };
}

/** A copy that no longer has its finding: an empty container the editor marks as gone. */
const goneFinding = (findingId: string): ReportNode => ({ type: "finding", attrs: { findingId, edited: false } satisfies FindingCopyAttrs, content: [para([])] });

/* ------------------------------------------------------------------ tables */

const hostName = (data: ReportData, id: string | null) => (id ? (data.hosts.find((h) => h.id === id)?.name ?? id) : "");

/** Text with `backtick` spans as code ("shell as `ronan`"). */
const ticked = (text: string): ReportNode[] =>
  text.split(/`([^`]*)`/).flatMap((t, i) => (t === "" ? [] : [textNode(t, i % 2 === 1 ? [{ type: "code" }] : [])]));

/** The result line after its bold "Result:": "shell as `ronan`, then root. local.txt `<value>`, proof.txt `<value>`." */
function resultContent(line: ResultLine): ReportNode[] {
  const out: ReportNode[] = [];
  if (line.access) out.push(textNode(" "), ...ticked(line.access), textNode("."));
  line.flags.forEach((f, i) => {
    out.push(textNode(i === 0 ? " " : ", "), textNode(`${f.kind}.txt `), textNode(f.value, [{ type: "code" }]));
    if (i === line.flags.length - 1) out.push(textNode("."));
  });
  return out;
}

/** The target a machine belongs to: the page's own, else the report's target holding it, else the machine alone. */
function targetOf(data: ReportData, target: ReportTarget | null, meta: ReportMeta, hostId: string): ReportTarget {
  if (target?.hostIds.includes(hostId)) return target;
  return reportTargets(data, meta).find((t) => t.hostIds.includes(hostId)) ?? { key: hostId, kind: "standalone", hostIds: [hostId] };
}

const none = (text = "None recorded.") => [para([textNode(text)])];
const label = (text: string) => para([bold(text)]);

/** The blocks of a generated table's copy, mirroring what the page printed live (GeneratedView). */
function tableContent(kind: CopiedKind, hostId: string | null, data: ReportData, target: ReportTarget | null, meta: ReportMeta, notes: Record<string, string>): ReportNode[] {
  const host = hostId ? data.hosts.find((h) => h.id === hostId) : undefined;
  const targets = () => reportTargets(data, meta);
  switch (kind) {
    case "result": {
      if (!host) return none("This host was deleted.");
      const rest = resultContent(resultLine(data, targetOf(data, target, meta, host.id), host.id, meta));
      return [para(joinText([bold("Result:"), ...(rest.length > 0 ? rest : [textNode(" No access or flags recorded yet.")])]))];
    }
    case "ports": {
      if (!host) return none("This host was deleted.");
      const rows = portRows(data, host.id);
      if (rows.length === 0) return none(`No open ports recorded for ${host.name}`);
      return [
        label("Port Scan Results"),
        table(
          ["Port", "Service", "Version", "Notes"].map(plain),
          rows.map((r) => [plain(r.port), plain(r.service), plain(r.version), plain(notes[r.serviceId] ?? "")]),
        ),
      ];
    }
    case "findings": {
      const rows = findingRows(data, targets());
      if (rows.length === 0) return none("No findings recorded yet.");
      return [
        table(
          ["#", "Host", "Finding", "Severity", "Result"].map(plain),
          rows.map((r) => [plain(String(r.n)), plain(r.host), plain(r.title), plain(r.severity ? capitalize(r.severity) : "Not set"), plain(r.result)]),
        ),
      ];
    }
    case "scope-table": {
      const rows = scopeRows(data, targets());
      if (rows.length === 0) return none("No targets in the report yet.");
      return [table(["Host", "IP address", "OS", "Set"].map(plain), rows.map((r) => [plain(r.host), plain(r.ip), plain(r.os), plain(r.set)]))];
    }
    case "attack-path": {
      const set = target?.kind === "ad-set" ? target : targets().find((t) => t.kind === "ad-set");
      const rows = attackPathRows(data, set?.hostIds ?? []);
      if (rows.length === 0) return none("No hops or access recorded on the AD set yet.");
      return [
        label("Attack path"),
        table(
          ["Step", "From", "Technique", "To", "Access gained"].map(plain),
          rows.map((r) => [plain(String(r.step)), plain(r.from), plain(r.technique), plain(r.to), ticked(r.access)]),
        ),
      ];
    }
    case "tested": {
      const rows = testedNotExploited(data, hostId);
      if (rows.length === 0) return none();
      return [table(["Tested", "Why it went nowhere"].map(plain), rows.map((r) => [plain(testedLine({ ...r, reason: "" })), plain(r.reason)]))];
    }
    case "cleanup": {
      const rows = data.cleanup.filter((c) => c.status !== "dismissed" && (!hostId || c.hostId === hostId));
      if (rows.length === 0) return none("No clean-up items recorded.");
      return [
        table(
          ["Item", "Host", "Kind", "Status"].map(plain),
          rows.map((c) => [plain(c.target), plain(hostName(data, c.hostId)), plain(c.kind), plain(c.status === "removed" ? "Removed" : "Still to remove")]),
        ),
      ];
    }
    case "references": {
      // Only findings on the report's targets: a host or a service of one.
      const onTargets = new Set(targets().flatMap((t) => t.hostIds));
      const linked = data.findings.filter(
        (f) => f.hostIds.some((id) => onTargets.has(id)) || f.serviceIds.some((id) => onTargets.has(data.services.find((s) => s.id === id)?.hostId ?? "")),
      );
      const refs = [...new Set(linked.flatMap((f) => f.refs))];
      if (refs.length === 0) return none();
      return refs.map((r) => para(inline(r)));
    }
  }
}

/**
 * A generated table (or the Result line) as the page's own editable copy (`table-block`): a real table built from the
 * same rows the live view printed, a label paragraph above it where the view had one ("Port Scan Results"), the Result
 * line as one paragraph with a bold "Result:" lead, the references as one paragraph each. `notes` fills a port table's
 * Notes column (service id → text).
 */
export function tableCopy(
  kind: CopiedKind,
  hostId: string | null,
  data: ReportData,
  target: ReportTarget | null,
  meta: ReportMeta,
  notes: Record<string, string> = {},
  appendix: TableBlockAttrs["appendix"] = "inline",
): ReportNode {
  return {
    type: "table-block",
    attrs: { kind, hostId, appendix, edited: false } satisfies TableBlockAttrs,
    content: tableContent(kind, hostId, data, target, meta, notes),
  };
}

export const isCopiedKind = (kind: unknown): kind is CopiedKind => COPIED_KINDS.includes(kind as CopiedKind);

const cellText = (cell: ReportNode | undefined): string => {
  const walk = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(walk).join("");
  return cell ? walk(cell).trim() : "";
};

/** A port table copy's Notes column, read back by port (service id → text), so Refresh keeps the owner's notes. */
function notesOf(block: ReportNode, data: ReportData): Record<string, string> {
  const tbl = (block.content ?? []).find((n) => n.type === "table");
  const [head, ...rows] = tbl?.content ?? [];
  const names = (head?.content ?? []).map(cellText);
  const portAt = names.indexOf("Port");
  const notesAt = names.indexOf("Notes");
  if (portAt === -1 || notesAt === -1 || typeof block.attrs?.hostId !== "string") return {};
  const byPort = new Map(portRows(data, block.attrs.hostId).map((r) => [r.port, r.serviceId]));
  const out: Record<string, string> = {};
  for (const r of rows) {
    const id = byPort.get(cellText(r.content?.[portAt]));
    const text = cellText(r.content?.[notesAt]);
    if (id && text) out[id] = text;
  }
  return out;
}

/* ------------------------------------------------------------------ evidence */

const cap = (text: string): [string, boolean] => (text.length > COPY_LIMIT ? [text.slice(0, COPY_LIMIT), true] : [text, false]);

/**
 * An evidence block's copy attrs: a command block's command and output (an HTTP entry: request and response in the
 * same fields), a flag's value and proof text; null for a screenshot (the image stays a reference) and a note (its
 * paragraphs are the copy). A field over `COPY_LIMIT` keeps its start and `truncated` says so. `block` indexes a
 * command entry's blocks; null is the whole entry.
 */
export function evidenceCopy(entry: LogEntry, block: number | null): { copy: EvidenceCopy | null; truncated: boolean } {
  const c = entry.content;
  let copy: EvidenceCopy | null = null;
  let truncated = false;
  const take = (text: string) => {
    const [kept, cut] = cap(text);
    truncated ||= cut;
    return kept;
  };
  if (c.kind === "command") {
    const blocks = block == null ? c.blocks : c.blocks.slice(block, block + 1);
    if (blocks.length > 0) {
      copy = { command: take(blocks.map((b) => b.command ?? "").join("\n")), output: take(blocks.map((b) => b.output ?? "").join("\n")) };
    }
  } else if (c.kind === "http") {
    copy = { command: take(c.request ?? ""), output: take(c.response ?? "") };
  } else if (c.kind === "flag") {
    copy = { value: take(c.value ?? ""), proof: c.proof == null ? null : take(c.proof) };
  }
  return { copy, truncated };
}

/** A finding file's copy attrs: its content, cut at `COPY_LIMIT`. */
export function exploitCopy(file: FindingFile): { copy: { content: string }; truncated: boolean } {
  const [content, truncated] = cap(file.content ?? "");
  return { copy: { content }, truncated };
}

/** The entry an evidence block copies from, when it may be copied: not private, not deleted. */
const sourceEntry = (data: ReportData, n: ReportNode) => {
  const e = data.log.find((l) => l.id === n.attrs?.entryId);
  return e && !e.private ? e : undefined;
};
const sourceFile = (data: ReportData, n: ReportNode) => data.findingFiles.find((f) => f.id === n.attrs?.fileId);

const withEvidenceCopy = (n: ReportNode, entry: LogEntry): ReportNode => ({
  ...n,
  attrs: { ...n.attrs, ...evidenceCopy(entry, (n.attrs as unknown as EvidenceAttrs).block ?? null) },
});
const withExploitCopy = (n: ReportNode, file: FindingFile): ReportNode => ({ ...n, attrs: { ...n.attrs, ...exploitCopy(file) } });

/* ------------------------------------------------------------------ upgrade and refresh */

/**
 * A layout-4 page converted in place to layout 5 (§10.8): each `vuln` becomes its finding's copy, each `generated` of a
 * copied kind its table copy (a port table's Notes and every block's appendix placement kept), and each evidence or
 * exploit block gains its copy attrs, keeping `keep`, `emphasis`, `caption`, `width` and `appendix`. Everything else,
 * every owner-written paragraph, step and slot included, is untouched. A private or deleted source is never copied: its
 * block stays as it was. A block that already holds a copy is left alone, so a second run changes nothing.
 */
export function upgradeDoc(doc: ReportNode, data: ReportData, target: ReportTarget | null, meta: ReportMeta): ReportNode {
  const walk = (n: ReportNode): ReportNode => {
    switch (n.type) {
      case "vuln": {
        const id = String(n.attrs?.findingId ?? "");
        const f = data.findings.find((x) => x.id === id);
        return f ? findingCopy(f) : goneFinding(id);
      }
      case "generated": {
        const kind = n.attrs?.kind;
        if (!isCopiedKind(kind)) return n;
        const notes = (n.attrs?.notes as Record<string, string> | undefined) ?? {};
        const appendix = n.attrs?.appendix === "moved" ? "moved" : "inline";
        return tableCopy(kind, (n.attrs?.hostId as string | null) ?? null, data, target, meta, notes, appendix);
      }
      case "evidence": {
        if (n.attrs?.copy !== undefined) return n;
        const e = sourceEntry(data, n);
        return e ? withEvidenceCopy(n, e) : n;
      }
      case "exploit": {
        if (n.attrs?.copy !== undefined) return n;
        const file = sourceFile(data, n);
        return file ? withExploitCopy(n, file) : n;
      }
      default:
        return n.content ? { ...n, content: n.content.map(walk) } : n;
    }
  };
  return walk(doc);
}

/**
 * The source's current copy of one block, for Refresh: an evidence block's entry (its placement attrs kept), an
 * exploit's finding file, a finding, a generated table (a port table keeps the owner's Notes). Null when the block has
 * no source (a heading, a paragraph, a slot) or its source is gone or private.
 */
export function refreshNode(node: ReportNode, data: ReportData, target: ReportTarget | null, meta: ReportMeta): ReportNode | null {
  switch (node.type) {
    case "evidence": {
      const e = sourceEntry(data, node);
      return e ? withEvidenceCopy(node, e) : null;
    }
    case "exploit": {
      const file = sourceFile(data, node);
      return file ? withExploitCopy(node, file) : null;
    }
    case "finding":
    case "vuln": {
      const f = data.findings.find((x) => x.id === node.attrs?.findingId);
      return f ? findingCopy(f) : null;
    }
    case "table-block":
    case "generated": {
      const kind = node.attrs?.kind;
      if (!isCopiedKind(kind)) return null;
      const hostId = (node.attrs?.hostId as string | null) ?? null;
      if (hostId && !data.hosts.some((h) => h.id === hostId)) return null;
      const notes = node.type === "generated" ? ((node.attrs?.notes as Record<string, string> | undefined) ?? {}) : notesOf(node, data);
      const appendix = (node.attrs?.appendix as AppendixPlacement | undefined) === "moved" ? "moved" : "inline";
      return tableCopy(kind, hostId, data, target, meta, notes, appendix);
    }
    default:
      return null;
  }
}

