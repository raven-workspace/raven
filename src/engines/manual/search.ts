import { fenceWalk, OUTLINE_HEADING, tableCaption } from "./anchors";
import { isInlineCommand, lookupRows, plain, type LookupRow } from "./lookup";
import { DEEP_HEADING, isTableStart, lineRuns, tableEnd, type Inline } from "./markdown";
import type { ManualNote } from "./types";
import { escapeRegExp } from "../regex";

export interface ManualHit {
  noteId: string;
  title: string;
  /** The nearest outline id before the matching line (a heading or `table-N`); absent before the first. */
  anchor?: string;
  /** The matching line as the note renders it, cut to about 120 characters around the match ("" for a title-only hit). */
  line: string;
  inTitle: boolean;
}


/**
 * The Manual's matcher: a case-insensitive substring of the trimmed query, where `_` and spaces are the same thing (so
 * `access denied` finds `ACCESS_DENIED`). Null for a query with nothing to find. Use with `matchAll` (it clones).
 */
export function matchRegex(query: string): RegExp | null {
  const parts = query.trim().split(/[\s_]+/);
  if (!parts.some(Boolean)) return null;
  return new RegExp(parts.map(escapeRegExp).join("[\\s_]+"), "gi");
}

/** Every match of `query` in `text` as `[start, end)` offsets, in order. */
export function matchRanges(text: string, query: string | RegExp | null): [number, number][] {
  const re = typeof query === "string" ? matchRegex(query) : query;
  if (!re) return [];
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) if (m[0]) out.push([m.index, m.index + m[0].length]);
  return out;
}

const MAX_LINE = 120;

const PLACEHOLDERS = /\{[A-Za-z][A-Za-z0-9_]*\}/g;

/**
 * `text` with every `{PLACEHOLDER}` blanked out, length kept: the note shows a placeholder filled for the host in view,
 * so its name is never a match (text around it still is).
 */
export function maskPlaceholders(text: string): string {
  return text.replace(PLACEHOLDERS, (m) => "\u0000".repeat(m.length));
}

/**
 * An inline run's text as the note shows it, split where the note marks matches separately: an inline command marks
 * its own matches (on its filled text), so it is a piece of its own; everything else in the run is one piece.
 */
function piecesOf(parts: Inline[]): string[] {
  const out: string[] = [""];
  const walk = (ps: Inline[]) => {
    for (const p of ps) {
      if ("code" in p && isInlineCommand(p.code)) out.push(p.code, "");
      else if ("strong" in p) walk(p.strong);
      else if ("em" in p) walk(p.em);
      else out[out.length - 1] += plain([p]);
    }
  };
  walk(parts);
  return out.filter(Boolean);
}

/** `line` cut to about MAX_LINE characters, keeping the match at `at` in view. */
function cut(line: string, at: number): string {
  if (line.length <= MAX_LINE) return line;
  let start = Math.max(0, at - 40);
  const end = Math.min(line.length, start + MAX_LINE);
  start = Math.max(0, end - MAX_LINE);
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`;
}

/**
 * A note's searchable line as it reads, with the outline id of its section. `pieces` are the `[start, end)` spans of
 * `text` a match may fall in: a match never crosses from one to the next, as the note never marks one that does.
 */
type Line = { text: string; pieces: [number, number][]; anchor?: string };

/** A run's pieces with the whitespace at its edges gone, as the note's whitespace collapses there. */
function trimmed(pieces: string[]): string[] {
  const out = [...pieces];
  if (out.length > 0) {
    out[0] = out[0]!.trimStart();
    out[out.length - 1] = out[out.length - 1]!.trimEnd();
  }
  return out.filter(Boolean);
}

/** A line's runs joined by `sep`, with each piece's span in the result. */
function lineOf(runs: string[][], sep: string): { text: string; pieces: [number, number][] } {
  let text = "";
  const pieces: [number, number][] = [];
  for (const run of runs.filter((r) => r.length > 0)) {
    if (text) text += sep;
    for (const piece of run) {
      pieces.push([text.length, text.length + piece.length]);
      text += piece;
    }
  }
  return { text, pieces };
}

/** Searchable lines per note: computed once per imported note, not on every keystroke. */
const linesCache = new WeakMap<ManualNote, Line[]>();

function linesOf(note: ManualNote): Line[] {
  const hit = linesCache.get(note);
  if (hit) return hit;
  const out: Line[] = [];
  const walk = fenceWalk();
  const lines = note.body.split("\n");
  let section = -1;
  // A table's header, separator and rows, as the renderer reads them: [header, end).
  let table: [number, number] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const kind = walk(raw);
    if (kind === "fence") continue;
    let line: { text: string; pieces: [number, number][] };
    if (kind === "code") line = lineOf([[raw.trim()]], "");
    else {
      const h = OUTLINE_HEADING.exec(raw);
      // The h1 repeats the title: a title hit already covers it.
      if (h?.[1] === "#") continue;
      // Same walk as the outline (`parseNote`): each `##`, `###` and table caption is the next outline entry.
      const caption = tableCaption(raw);
      if (h || caption) section++;
      // As in the renderer, a heading or a caption is never a table's header.
      if (!table || i >= table[1]) table = !h && !caption && !DEEP_HEADING.test(raw) && isTableStart(lines, i) ? [i, tableEnd(lines, i)] : null;
      // The separator row renders nothing.
      if (table && i === table[0] + 1) continue;
      const { runs, sep } = lineRuns(raw, table !== null);
      line = lineOf(runs.map((r) => trimmed(piecesOf(r))), sep);
    }
    if (!line.text) continue;
    const anchor = note.outline[section]?.id;
    out.push(anchor ? { ...line, anchor } : line);
  }
  linesCache.set(note, out);
  return out;
}

/** The note's first body match (fenced code included), with its section, or null. */
function firstBodyMatch(note: ManualNote, re: RegExp): { anchor?: string; line: string } | null {
  for (const l of linesOf(note)) {
    for (const [start, end] of l.pieces) {
      const m = matchRanges(maskPlaceholders(l.text.slice(start, end)), re)[0];
      if (m) return { ...(l.anchor ? { anchor: l.anchor } : {}), line: cut(l.text, start + m[0]) };
    }
  }
  return null;
}

/**
 * The Manual's ⌘K search: title matches first, then body matches, each in note order; one hit per note (its first
 * match), at most `max`.
 */
export function searchManual(query: string, notes: ManualNote[], max = 8): ManualHit[] {
  const re = matchRegex(query);
  if (!re) return [];
  const titled: ManualHit[] = [];
  const bodied: ManualHit[] = [];
  for (const n of notes) {
    const inTitle = matchRanges(n.title, re).length > 0;
    if (inTitle && titled.length >= max) continue;
    if (!inTitle && bodied.length >= max) continue;
    const body = firstBodyMatch(n, re);
    if (inTitle) titled.push({ noteId: n.id, title: n.title, ...(body ?? { line: "" }), inTitle });
    else if (body) bodied.push({ noteId: n.id, title: n.title, ...body, inTitle });
  }
  return [...titled, ...bodied].slice(0, max);
}

/**
 * ⌘K's Lookup group: lookup-table rows with at least one command whose key or means matches the query. Key matches
 * come before means matches, each in note order; at most `max`. `keep` drops a row before it counts toward `max` (the
 * palette's exam rules), so a dropped row never crowds out one after it.
 */
export function searchLookups(query: string, notes: ManualNote[], max = 2, keep: (row: LookupRow) => boolean = () => true): LookupRow[] {
  const re = matchRegex(query);
  if (!re) return [];
  const keyed: LookupRow[] = [];
  const meant: LookupRow[] = [];
  for (const n of notes) {
    for (const r of lookupRows(n)) {
      if (r.commands.length === 0) continue;
      if (matchRanges(r.key, re).length > 0) {
        if (keep(r)) keyed.push(r);
      } else if (meant.length < max && matchRanges(plain(r.means), re).length > 0 && keep(r)) meant.push(r);
    }
    if (keyed.length >= max) break;
  }
  return [...keyed, ...meant].slice(0, max);
}
