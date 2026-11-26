import { splitWikilinks } from "../library/wikilinks";
import { anchorIds, closesFence, FENCE, OUTLINE_HEADING, openFence, tableCaption } from "./anchors";

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

export const DEEP_HEADING = /^(#{4,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
export const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;

/** Lines that always start a block of their own (so the outline and the renderer agree on every anchor). */
const startsBlock = (line: string): boolean =>
  FENCE.test(line) || OUTLINE_HEADING.test(line) || DEEP_HEADING.test(line) || tableCaption(line) !== null;

/** An unescaped `|`: the cell delimiter. */
const PIPE = /(^|[^\\])\|/;

/** A line that can be a row of a pipe table: it holds a cell delimiter (GFM: the outer pipes are optional). */
export const isTableRow = (line: string) => line.trim() !== "" && PIPE.test(line);

/**
 * Whether a pipe table starts at `lines[i]` (GFM): a header row, then a separator row (`| --- |`, `--- | ---`) with the
 * same number of cells. Prose with a `|` over a `---` rule, or over a separator of another width, is no table.
 */
export const isTableStart = (lines: string[], i: number) => {
  const head = lines[i];
  const sep = lines[i + 1];
  return head !== undefined && sep !== undefined && isTableRow(head) && TABLE_SEPARATOR.test(sep) && sep.includes("-")
    && cells(head).length === cells(sep).length;
};

/**
 * The index after the table that starts at `lines[i]` (`isTableStart`): its body rows run while each holds a cell
 * delimiter and starts no other block (a fence, a heading, a table caption).
 */
export function tableEnd(lines: string[], i: number): number {
  let j = i + 2;
  while (j < lines.length && isTableRow(lines[j]) && !startsBlock(lines[j])) j++;
  return j;
}

/**
 * The fenced code block opening at `lines[i]`, or null when that line is no fence: the info string after the fence,
 * the body, and the index after the closing fence. Same rule as the outline (`closesFence`): a fence closes on a
 * fence of the same character at least as long, with nothing after it (or at the end of the text). CommonMark: the
 * opening fence's indent (a fence inside a list item) comes off each body line, so a copied command never starts with
 * a space.
 */
export function readFence(lines: string[], i: number): { info: string; text: string; next: number } | null {
  const line = lines[i];
  const fence = openFence(line);
  if (!fence) return null;
  const indent = /^[ \t]*/.exec(line)![0].length;
  const dedent = (l: string) => l.replace(new RegExp(`^[ \\t]{0,${indent}}`), "");
  const text: string[] = [];
  let j = i + 1;
  while (j < lines.length && !closesFence(lines[j], fence)) {
    text.push(dedent(lines[j]));
    j++;
  }
  return { info: line.replace(FENCE, ""), text: text.join("\n"), next: j + 1 };
}

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

/** `urls`: an external `[label](url)` keeps its URL as text ("label (url)"), for printed pages; the Manual drops it. */
export interface MarkdownOptions {
  urls?: boolean;
}

export function parseMarkdown(body: string, opts: MarkdownOptions = {}): Block[] {
  const parseInline = (s: string) => parseInlineWith(s, opts);
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const ids = anchorIds();
  // h1 and h4+ are not in the outline: their ids come from a counter of their own, namespaced (`h1-…`, `h4-…`), so they
  // never take an outline id that a link or the outline jumps to.
  const minor = anchorIds();
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = readFence(lines, i);
    if (fence) {
      out.push({ kind: "code", ...fenceInfo(fence.info), text: fence.text });
      i = fence.next;
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
    if (isTableStart(lines, i)) {
      const end = tableEnd(lines, i);
      const head = cells(line).map(parseInline);
      const rows = lines.slice(i + 2, end).map((l) => cells(l).map(parseInline));
      i = end;
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
      // A line that starts with `|` breaks the paragraph, as it always has, as does a table without outer pipes.
      const table = l.trim().startsWith("|") || isTableStart(lines, i);
      if (l.trim() === "" || startsBlock(l) || RULE.test(l) || (text.length > 0 && (LIST_ITEM.test(l) || table))) break;
      text.push(l.replace(QUOTE, "").replace(/^\[![\w-]+\][+-]?\s*/, "").trim());
      i++;
    }
    const joined = text.filter((t) => t !== "").join(" ");
    if (joined !== "") out.push({ kind: "paragraph", inline: parseInline(joined) });
  }
  return out;
}

/**
 * One source line outside a fence as the note renders it: its inline runs (a table row's cells, when `row` says the
 * line is one; a caption's bold name and its trail), each parsed as `parseMarkdown` parses it, and the separator they
 * read with. Heading, list, quote and callout markers come off. A blank line or a rule renders nothing: no runs.
 */
export function lineRuns(line: string, row = false): { runs: Inline[][]; sep: string } {
  const none = { runs: [], sep: "" };
  if (line.trim() === "" || RULE.test(line)) return none;
  if (row) return { runs: cells(line).filter(Boolean).map((c) => parseInline(c)), sep: "  " };
  const h = OUTLINE_HEADING.exec(line) ?? DEEP_HEADING.exec(line);
  if (h) return { runs: [parseInline(h[2])], sep: "" };
  const caption = tableCaption(line);
  if (caption) {
    const trimmed = line.trim();
    const head = parseInline(trimmed.slice(0, trimmed.length - caption.trail.length).trim());
    return { runs: caption.trail ? [head, parseInline(caption.trail)] : [head], sep: " " };
  }
  const item = LIST_ITEM.exec(line);
  const text = item ? item[2] : line.replace(QUOTE, "").replace(/^\[![\w-]+\][+-]?\s*/, "").trim();
  return text === "" ? none : { runs: [parseInline(text)], sep: "" };
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

function atomAt(s: string, i: number, opts: MarkdownOptions = {}): Atom | null {
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
    if (m) {
      const text = opts.urls && m[2] && m[2] !== m[1] ? `${m[1]} (${m[2]})` : m[1];
      return { node: { text }, len: m[0].length, first: text[0], last: text[text.length - 1] };
    }
  }
  if (c === "<") {
    // A line break inside a table cell reads as a space.
    const br = /^<br\s*\/?>/i.exec(s.slice(i));
    if (br) return { node: { text: " " }, len: br[0].length, first: " ", last: " " };
  }
  return null;
}

/**
 * A run of `*` or `_` waiting to be matched: `n` markers left of `orig`. `at` is its place among the line's runs, in
 * order; `node` is where it sits in the line, and `prev`/`next` link the runs still on the delimiter stack.
 */
type Delim = {
  delim: "*" | "_"; n: number; orig: number; open: boolean; close: boolean; at: number;
  node?: Node; prev?: Delim | null; next?: Delim | null;
};
type Item = Inline | Delim;
const isDelim = (x: Item): x is Delim => "delim" in x;
/** One item of a line, linked to its neighbours: matching wraps a span in place, never splicing an array. */
type Node = { item: Item; prev: Node | null; next: Node | null };

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
  return parseInlineWith(s, {});
}

/** `parseInline` with options (`MarkdownOptions`). */
export function parseInlineWith(s: string, opts: MarkdownOptions): Inline[] {
  const items: Item[] = [];
  let buf = "";
  const flush = () => {
    if (buf !== "") items.push({ text: buf });
    buf = "";
  };
  let prev = " ";
  let runs = 0;
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
        delim: c, n, orig: n, at: runs++,
        open: c === "*" ? left : left && (!right || isPunct(before)),
        close: c === "*" ? right : right && (!left || isPunct(after)),
      });
      prev = c;
      i += n;
      continue;
    }
    const atom = atomAt(s, i, opts);
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

  return emphasis(items);
}

/** The rule of 3: a marker that can both open and close does not pair across a multiple-of-3 total. */
const pairs = (opener: Delim, closer: Delim) =>
  !((opener.close || closer.open) && (opener.orig + closer.orig) % 3 === 0 && !(opener.orig % 3 === 0 && closer.orig % 3 === 0));

/**
 * CommonMark's "process emphasis": each closer pairs with the nearest opener of the same marker before it. Linear in
 * the line: the items are a linked list (a match wraps its span in place), the delimiter stack is linked too, and
 * `openers_bottom` remembers, per kind of closer, how far down a search already failed, so no run is searched twice.
 */
function emphasis(items: Item[]): Inline[] {
  const head: Node = { item: { text: "" }, prev: null, next: null };
  let last = head;
  let bottomD: Delim | null = null;
  let topD: Delim | null = null;
  for (const item of items) {
    const node: Node = { item, prev: last, next: null };
    last.next = node;
    last = node;
    if (isDelim(item)) {
      Object.assign(item, { node, prev: topD, next: null });
      if (topD) topD.next = item;
      else bottomD = item;
      topD = item;
    }
  }
  const unstack = (d: Delim) => {
    if (d.prev) d.prev.next = d.next ?? null;
    else bottomD = d.next ?? null;
    if (d.next) d.next.prev = d.prev ?? null;
  };
  const unlink = (x: Node) => {
    x.prev!.next = x.next;
    if (x.next) x.next.prev = x.prev;
  };

  // openers_bottom: per marker, "can open" and length mod 3, the `at` at or below which no opener can pair.
  const floor = new Map<string, number>();
  let closer: Delim | null = bottomD;
  while (closer) {
    if (!closer.close) {
      closer = closer.next ?? null;
      continue;
    }
    const kind = `${closer.delim}${closer.open ? 1 : 0}${closer.orig % 3}`;
    const bottom = floor.get(kind) ?? -1;
    let opener = closer.prev ?? null;
    while (opener && opener.at > bottom && !(opener.delim === closer.delim && opener.open && pairs(opener, closer))) opener = opener.prev ?? null;
    if (!opener || opener.at <= bottom) {
      floor.set(kind, closer.prev?.at ?? -1);
      const next: Delim | null = closer.next ?? null;
      // A closer that cannot open is done: it stays as text.
      if (!closer.open) unstack(closer);
      closer = next;
      continue;
    }
    const use = opener.n >= 2 && closer.n >= 2 ? 2 : 1;
    const inner: Item[] = [];
    for (let x = opener.node!.next; x && x !== closer.node; x = x.next) inner.push(x.item);
    const wrapped: Node = { item: use === 2 ? { strong: settle(inner) } : { em: settle(inner) }, prev: opener.node!, next: closer.node! };
    opener.node!.next = wrapped;
    closer.node!.prev = wrapped;
    // Runs between the pair are text now.
    opener.next = closer;
    closer.prev = opener;
    opener.n -= use;
    closer.n -= use;
    if (opener.n === 0) {
      unlink(opener.node!);
      unstack(opener);
    }
    if (closer.n === 0) {
      const next: Delim | null = closer.next ?? null;
      unlink(closer.node!);
      unstack(closer);
      closer = next;
    }
  }
  const out: Item[] = [];
  for (let x = head.next; x; x = x.next) out.push(x.item);
  return settle(out);
}
