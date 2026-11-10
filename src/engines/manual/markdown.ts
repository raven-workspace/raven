import { splitWikilinks } from "../library/wikilinks";
import { anchorIds, FENCE, OUTLINE_HEADING, TABLE_CAPTION } from "./anchors";

/**
 * A small, safe Markdown reader for Manual notes: it turns a note body into plain data that the renderer maps to React
 * elements. Raw HTML is never markup here; it stays as text.
 */
export type Inline =
  | { text: string }
  | { code: string }
  | { strong: Inline[] }
  | { em: Inline[] }
  | { link: { target: string; heading?: string; label: string } };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; id: string; inline: Inline[] }
  /** `anchor`: "table-N" on a table caption line. */
  | { kind: "paragraph"; inline: Inline[]; anchor?: string }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "code"; lang: string; title?: string; text: string };

const DEEP_HEADING = /^(#{4,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;

/** Lines that always start a block of their own (so the outline and the renderer agree on every anchor). */
const startsBlock = (line: string): boolean =>
  FENCE.test(line) || OUTLINE_HEADING.test(line) || DEEP_HEADING.test(line) || TABLE_CAPTION.test(line.trim());

const isTableRow = (line: string) => line.trim().startsWith("|");

/** Cells of a pipe-table row: split on unescaped pipes; `\|` is a literal pipe. */
function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      out.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  out.push(cur.trim());
  return out;
}

/** The fence info string: its language, and a `title:"…"` (or `title:word`). */
function fenceInfo(info: string): { lang: string; title?: string } {
  const lang = /^[^\s{]*/.exec(info.trim())?.[0] ?? "";
  const t = /title:\s*(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(info);
  const title = t ? (t[1] ?? t[2] ?? t[3]).trim() : "";
  return title ? { lang, title } : { lang };
}

export function parseMarkdown(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const ids = anchorIds();
  // h1 and h4+ are not in the outline: their ids come from a counter of their own, namespaced (`h1-…`, `h4-…`), so they
  // never take an outline id that a link or the outline jumps to.
  const minor = anchorIds();
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      // Same rule as the outline: a fence closes on the next fence line of the same character (or the end of the note).
      const ch = fence[1][0];
      // CommonMark: the opening fence's indent (a fence inside a list item) comes off each content line, so a copied
      // command never starts with a space.
      const indent = /^[ \t]*/.exec(line)![0].length;
      const dedent = (l: string) => l.replace(new RegExp(`^[ \\t]{0,${indent}}`), "");
      const text: string[] = [];
      i++;
      while (i < lines.length) {
        const f = FENCE.exec(lines[i]);
        if (f && f[1][0] === ch) break;
        text.push(dedent(lines[i]));
        i++;
      }
      i++;
      out.push({ kind: "code", ...fenceInfo(line.replace(FENCE, "")), text: text.join("\n") });
      continue;
    }
    const h = OUTLINE_HEADING.exec(line);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      const id = level === 1 ? minor.heading(`h1 ${h[2]}`) : ids.heading(h[2]);
      out.push({ kind: "heading", level, id, inline: parseInline(h[2]) });
      i++;
      continue;
    }
    const deep = DEEP_HEADING.exec(line);
    if (deep) {
      out.push({ kind: "heading", level: 4, id: minor.heading(`h4 ${deep[2]}`), inline: parseInline(deep[2]) });
      i++;
      continue;
    }
    const caption = TABLE_CAPTION.exec(line.trim());
    if (caption) {
      out.push({ kind: "paragraph", anchor: ids.table(caption[1]), inline: parseInline(line.trim()) });
      i++;
      continue;
    }
    if (line.trim() === "" || RULE.test(line)) {
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = cells(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i]) && !startsBlock(lines[i])) {
        rows.push(cells(lines[i]).map(parseInline));
        i++;
      }
      out.push({ kind: "table", head, rows });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[1]);
      const items: string[] = [];
      while (i < lines.length && !startsBlock(lines[i])) {
        const l = lines[i];
        const it = LIST_ITEM.exec(l);
        if (it) items.push(it[2]);
        else if (l.trim() !== "" && /^\s/.test(l)) items[items.length - 1] += ` ${l.trim()}`;
        else break;
        i++;
      }
      out.push({ kind: "list", ordered, items: items.map(parseInline) });
      continue;
    }
    // A paragraph (a quote or callout reads as plain text): runs to a blank line or the next block.
    const text: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "" || startsBlock(l) || RULE.test(l) || (text.length > 0 && (LIST_ITEM.test(l) || isTableRow(l)))) break;
      text.push(l.replace(QUOTE, "").replace(/^\[![\w-]+\][+-]?\s*/, "").trim());
      i++;
    }
    const joined = text.filter((t) => t !== "").join(" ");
    if (joined !== "") out.push({ kind: "paragraph", inline: parseInline(joined) });
  }
  return out;
}

const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const PUNCT = /[\\`*_{}[\]()#+\-.!|<>~]/;

/** Where an emphasis run of `delim` opened at `from` closes, or -1. `_` never opens or closes inside a word. */
function closing(s: string, from: number, delim: string): number {
  const n = delim.length;
  for (let j = from; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "`") {
      // Skip a code span: emphasis markers inside it are literal.
      const run = /^`+/.exec(s.slice(j))![0];
      const end = s.indexOf(run, j + run.length);
      if (end > 0) j = end + run.length - 1;
      continue;
    }
    if (s.startsWith(delim, j) && !isSpace(s[j - 1])) {
      if (n === 1 && s[j + 1] === delim) {
        // A double marker inside single emphasis belongs to a nested strong: skip past it.
        const inner = closing(s, j + 2, delim + delim);
        if (inner > 0) {
          j = inner + 1;
          continue;
        }
      }
      if (delim[0] === "_" && isWord(s[j + n])) continue;
      return j;
    }
  }
  return -1;
}

/** Inline Markdown: code spans, `[[wikilinks]]`, `[label](url)` (its label only), strong and em. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf !== "") out.push({ text: buf });
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && PUNCT.test(s[i + 1] ?? "")) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0) {
        flush();
        const code = s.slice(i + run.length, end);
        out.push({ code: /^ .* $/.test(code) && code.trim() !== "" ? code.slice(1, -1) : code });
        i = end + run.length;
        continue;
      }
      buf += run;
      i += run.length;
      continue;
    }
    if (s.startsWith("[[", i)) {
      const end = s.indexOf("]]", i + 2);
      const piece = end > 0 ? splitWikilinks(s.slice(i, end + 2)) : [];
      const link = piece.length === 1 && "target" in piece[0] ? piece[0] : null;
      if (link) {
        flush();
        out.push({ link: { target: link.target, ...(link.heading ? { heading: link.heading } : {}), label: link.label } });
        i = end + 2;
        continue;
      }
    }
    if (c === "[") {
      const m = /^\[([^\]]+)\]\(([^)\s]*)\)/.exec(s.slice(i));
      if (m) {
        // External links stay text (Raven is offline): the label is what reads.
        buf += m[1];
        i += m[0].length;
        continue;
      }
    }
    if (c === "*" || c === "_") {
      const double = s[i + 1] === c;
      const delim = double ? c + c : c;
      const after = s[i + delim.length];
      const opens = !isSpace(after) && !(c === "_" && isWord(s[i - 1]));
      if (opens) {
        const end = closing(s, i + delim.length + 1, delim);
        if (end > 0) {
          flush();
          const inner = parseInline(s.slice(i + delim.length, end));
          out.push(double ? { strong: inner } : { em: inner });
          i = end + delim.length;
          continue;
        }
      }
      buf += delim;
      i += delim.length;
      continue;
    }
    if (c === "<" && /^<br\s*\/?>/i.test(s.slice(i))) {
      // A line break inside a table cell reads as a space.
      buf += " ";
      i += /^<br\s*\/?>/i.exec(s.slice(i))![0].length;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}
