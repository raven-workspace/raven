import { FENCE, OUTLINE_HEADING, TABLE_CAPTION } from "./anchors";
import { cells, TABLE_SEPARATOR } from "./markdown";
import type { ManualNote } from "./types";

export interface ManualHit {
  noteId: string;
  title: string;
  /** The nearest outline id before the matching line (a heading or `table-N`); absent before the first. */
  anchor?: string;
  /** The matching line, Markdown markers stripped, cut to about 120 characters around the match ("" for a title-only hit). */
  line: string;
  inTitle: boolean;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The Manual's matcher: a case-insensitive substring of the trimmed query, where `_` and spaces are the same thing (so
 * `access denied` finds `ACCESS_DENIED`). Null for a query with nothing to find. Use with `matchAll` (it clones).
 */
export function matchRegex(query: string): RegExp | null {
  const parts = query.trim().split(/[\s_]+/);
  if (!parts.some(Boolean)) return null;
  return new RegExp(parts.map(escapeRe).join("[\\s_]+"), "gi");
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

/** A source line as it reads on screen: heading, quote and list markers, table pipes, emphasis and link syntax gone. */
function readable(line: string): string {
  let s = line.trim();
  if (s.startsWith("|")) return cells(s).filter(Boolean).map(readable).join(" · ");
  s = s
    .replace(/^#{1,6}\s+/, "").replace(/\s+#+$/, "")
    .replace(/^>\s?/, "")
    .replace(/^([-*+]|\d+[.)])\s+/, "")
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) => label ?? target.replace("#", " "))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/(^|[^\w*])\*(\S(?:[^*]*\S)?)\*(?=[^\w*]|$)/g, "$1$2")
    .replace(/`/g, "");
  return s.trim();
}

/** `line` cut to about MAX_LINE characters, keeping the match at `at` in view. */
function cut(line: string, at: number): string {
  if (line.length <= MAX_LINE) return line;
  let start = Math.max(0, at - 40);
  const end = Math.min(line.length, start + MAX_LINE);
  start = Math.max(0, end - MAX_LINE);
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`;
}

/** The note's first body match (fenced code included), with its section, or null. */
function firstBodyMatch(note: ManualNote, re: RegExp): { anchor?: string; line: string } | null {
  let fence: string | null = null;
  let section = -1;
  for (const raw of note.body.split("\n")) {
    const f = FENCE.exec(raw);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    let line: string;
    if (fence !== null) line = raw.trim();
    else {
      const h = OUTLINE_HEADING.exec(raw);
      // The h1 repeats the title: a title hit already covers it.
      if (h?.[1] === "#") continue;
      // Same walk as the outline (`parseNote`): each `##`, `###` and table caption is the next outline entry.
      if (h || TABLE_CAPTION.test(raw.trim())) section++;
      if (TABLE_SEPARATOR.test(raw) && raw.includes("-")) continue;
      line = readable(raw);
    }
    const m = matchRanges(line, re)[0];
    if (!m) continue;
    const anchor = note.outline[section]?.id;
    return { ...(anchor ? { anchor } : {}), line: cut(line, m[0]) };
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
