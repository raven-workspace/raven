import { splitWikilinks } from "../library/wikilinks";
import { anchorIds, FENCE, OUTLINE_HEADING, tableCaption } from "./anchors";

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
  /** `anchor`: "table-N" on a table caption line; `trail`: the caption's text after its bold name, if any. */
  | { kind: "paragraph"; inline: Inline[]; anchor?: string; trail?: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "code"; lang: string; title?: string; text: string };

const DEEP_HEADING = /^(#{4,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
export const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;

/** Lines that always start a block of their own (so the outline and the renderer agree on every anchor). */
const startsBlock = (line: string): boolean =>
  FENCE.test(line) || OUTLINE_HEADING.test(line) || DEEP_HEADING.test(line) || tableCaption(line) !== null;

const isTableRow = (line: string) => line.trim().startsWith("|");

/** Cells of a pipe-table row: split on unescaped pipes; `\|` is a literal pipe. */
export function cells(line: string): string[] {
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
    const caption = tableCaption(line);
    if (caption) {
      const trimmed = line.trim();
      const head = trimmed.slice(0, trimmed.length - caption.trail.length).trim();
      out.push({
        kind: "paragraph", anchor: ids.table(caption.number), inline: parseInline(head),
        ...(caption.trail ? { trail: parseInline(caption.trail) } : {}),
      });
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

const isSpace = (c: string) => /\s/.test(c);
const isPunct = (c: string) => /[\p{P}\p{S}]/u.test(c);
const PUNCT = /[\\`*_{}[\]()#+\-.!|<>~]/;

/**
 * Anything at `i` that is not an emphasis marker and not a plain character: an escape, a code span, a wikilink, a
 * `[label](url)` (its label only), a `<br>`. `first`/`last` are what the run reads as on either side for the emphasis
 * flanking rules: a code span or wikilink is an opaque atom that reads as a letter.
 */
type Atom = { node: Inline; len: number; first: string; last: string };

function atomAt(s: string, i: number): Atom | null {
  const c = s[i];
  if (c === "\\" && PUNCT.test(s[i + 1] ?? "")) return { node: { text: s[i + 1] }, len: 2, first: s[i + 1], last: s[i + 1] };
  if (c === "`") {
    const run = /^`+/.exec(s.slice(i))![0];
    const end = s.indexOf(run, i + run.length);
    if (end < 0) return { node: { text: run }, len: run.length, first: "`", last: "`" };
    const code = s.slice(i + run.length, end);
    const node = { code: /^ .* $/.test(code) && code.trim() !== "" ? code.slice(1, -1) : code };
    return { node, len: end + run.length - i, first: "a", last: "a" };
  }
  if (s.startsWith("[[", i)) {
    const end = s.indexOf("]]", i + 2);
    const piece = end > 0 ? splitWikilinks(s.slice(i, end + 2)) : [];
    const link = piece.length === 1 && "target" in piece[0] ? piece[0] : null;
    if (link) {
      const node = { link: { target: link.target, ...(link.heading ? { heading: link.heading } : {}), label: link.label } };
      return { node, len: end + 2 - i, first: "a", last: "a" };
    }
  }
  if (c === "[") {
    // External links stay text (Raven is offline): the label is what reads.
    const m = /^\[([^\]]+)\]\(([^)\s]*)\)/.exec(s.slice(i));
    if (m) return { node: { text: m[1] }, len: m[0].length, first: m[1][0], last: m[1][m[1].length - 1] };
  }
  if (c === "<") {
    // A line break inside a table cell reads as a space.
    const br = /^<br\s*\/?>/i.exec(s.slice(i));
    if (br) return { node: { text: " " }, len: br[0].length, first: " ", last: " " };
  }
  return null;
}

/** A run of `*` or `_` waiting to be matched: `n` markers left of `orig`. */
type Delim = { delim: "*" | "_"; n: number; orig: number; open: boolean; close: boolean };
type Item = Inline | Delim;
const isDelim = (x: Item): x is Delim => "delim" in x;

/** Items to inline runs: unmatched markers become text, and neighbouring text joins. */
function settle(items: Item[]): Inline[] {
  const out: Inline[] = [];
  for (const x of items) {
    const node = isDelim(x) ? { text: x.delim.repeat(x.n) } : x;
    const last = out[out.length - 1];
    if ("text" in node && last && "text" in last) out[out.length - 1] = { text: last.text + node.text };
    else if (!("text" in node) || node.text !== "") out.push(node);
  }
  return out;
}

/**
 * Inline Markdown: code spans, `[[wikilinks]]`, `[label](url)` (its label only), strong and em. Emphasis follows the
 * CommonMark delimiter rules, with code spans and wikilinks as opaque atoms (so `**`code`** or **`code`**` is two
 * strongs, and `_` never opens or closes inside a word).
 */
export function parseInline(s: string): Inline[] {
  const items: Item[] = [];
  let buf = "";
  const flush = () => {
    if (buf !== "") items.push({ text: buf });
    buf = "";
  };
  let prev = " ";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "*" || c === "_") {
      let n = 1;
      while (s[i + n] === c) n++;
      const before = prev;
      const after = i + n < s.length ? (atomAt(s, i + n)?.first ?? s[i + n]) : " ";
      const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
      const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
      flush();
      items.push({
        delim: c, n, orig: n,
        open: c === "*" ? left : left && (!right || isPunct(before)),
        close: c === "*" ? right : right && (!left || isPunct(after)),
      });
      prev = c;
      i += n;
      continue;
    }
    const atom = atomAt(s, i);
    if (atom) {
      if ("text" in atom.node) buf += atom.node.text;
      else {
        flush();
        items.push(atom.node);
      }
      prev = atom.last;
      i += atom.len;
      continue;
    }
    buf += c;
    prev = c;
    i++;
  }
  flush();

  // Match each closer with the nearest opener of the same marker before it (CommonMark "process emphasis").
  let c = 0;
  while (c < items.length) {
    const closer = items[c];
    if (!isDelim(closer) || !closer.close) {
      c++;
      continue;
    }
    let o = c - 1;
    for (; o >= 0; o--) {
      const op = items[o];
      if (!isDelim(op) || op.delim !== closer.delim || !op.open) continue;
      // The rule of 3: a marker that can both open and close does not pair across a multiple-of-3 total.
      const both = op.close || closer.open;
      if (both && (op.orig + closer.orig) % 3 === 0 && !(op.orig % 3 === 0 && closer.orig % 3 === 0)) continue;
      break;
    }
    if (o < 0) {
      if (!closer.open) closer.close = false;
      c++;
      continue;
    }
    const opener = items[o] as Delim;
    const use = opener.n >= 2 && closer.n >= 2 ? 2 : 1;
    const inner = settle(items.slice(o + 1, c));
    items.splice(o + 1, c - o - 1, use === 2 ? { strong: inner } : { em: inner });
    c = o + 2;
    opener.n -= use;
    closer.n -= use;
    if (opener.n === 0) {
      items.splice(o, 1);
      c--;
    }
    if (closer.n === 0) items.splice(c, 1);
  }
  return settle(items);
}
