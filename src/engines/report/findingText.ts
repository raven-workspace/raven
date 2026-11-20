import { cells, parseInlineWith, TABLE_SEPARATOR, type Inline } from "../manual/markdown";
import { terminalBlocks } from "./terminal";
import { bold, codeBlock, joinText, listItem, para, table, text as textNode, type Mark } from "./nodes";
import type { ReportNode } from "./types";

/** Finding text and its inline Markdown as page blocks: the plain draft writes a finding's description and remediation with these. */

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
      out.push(table(head.map(joinText), rows.map((r) => r.map(joinText))));
      continue;
    }
    const kind = BULLET_ITEM.test(line) ? "bullet" : ORDERED_ITEM.test(line) ? "ordered" : null;
    const itemRe = kind === "bullet" ? BULLET_ITEM : ORDERED_ITEM;
    if (kind && i + 1 < lines.length && itemRe.test(lines[i + 1])) {
      flush();
      while (i < lines.length && itemRe.test(lines[i])) {
        out.push(listItem(kind, [para(inline(itemRe.exec(lines[i])![1].trim()))]));
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
  return terminalBlocks(text).flatMap((run) => (run.kind === "code" ? [codeBlock(run.text, { bareWhenEmpty: true })] : proseBlocks(run.text)));
}

/** A labelled part: the bold label leads the first paragraph; before a list, code or table it is a line of its own. */
export function labelled(label: string, blocks: ReportNode[]): ReportNode[] {
  const [first, ...rest] = blocks;
  if (first?.type === "paragraph") return [para(joinText([bold(label), textNode(" "), ...(first.content ?? [])])), ...rest];
  return [para([bold(label)]), ...blocks];
}
