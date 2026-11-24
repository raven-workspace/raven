import { matches, searchArsenal, wordsOf, type ArsenalGroup, type ArsenalHit } from "../../engines/library/arsenalSearch";
import type { CardMeta } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import { filterForKind } from "../../engines/checklist/examRules";
import { classifyExam } from "../../engines/fieldManual/classifyExam";
import type { ManualNote } from "../../engines/manual";
import { plain, type LookupRow } from "../../engines/manual/lookup";
import { searchLookups, searchManual } from "../../engines/manual/search";
import type { EngagementKind } from "../../types/engagement";
import { escapeRegExp } from "../../engines/regex";

/** Something in the open engagement the palette can jump to. Credential items carry a label only, never a secret. */
export interface EngagementItem {
  id: string;
  kind: "log" | "note" | "credential" | "host";
  title: string;
  /** Extra searchable text (a log entry's commands, a note's body). Never a secret. */
  text: string;
}

export interface PaletteContext {
  library: LibraryCommand[];
  cards: CardMeta[];
  generators: { id: string; title: string; category: string }[];
  engagementItems?: EngagementItem[];
  /** Exam rules; absent means no engagement kind applies. */
  exam?: { kind: EngagementKind; hostId: string; msfHostId?: string | null };
  /** The engagement (so its exam rules) is not known yet: no commands are offered (fail closed). */
  examPending?: boolean;
  /** The Manual's notes: searched in full text, after commands and cards. */
  notes?: ManualNote[];
}

/** A lookup-table row's command as a ⌘K command: `lookup` is where the row sits in the Manual (its table and row). */
export type LookupHit = Extract<ArsenalHit, { type: "command" }> & { lookup: { noteId: string; anchor: string; row: number } };

/** One lookup-table row in ⌘K: its key and plain means lead the group, its commands are the results. */
export interface LookupGroup {
  key: string;
  code: string;
  text: string;
  results: LookupHit[];
}

export type PaletteResult =
  | ArsenalHit
  | LookupHit
  | { type: "item"; id: string; title: string; item: EngagementItem }
  /** A Manual note: `line` is its matching line, `anchor` the section it sits in. */
  | { type: "manual"; id: string; title: string; noteId: string; anchor?: string; line: string }
  /** The matches the dialog's height cap left out: opens the same search in the full Arsenal. */
  | { type: "more"; id: string; title: string; count: number };


/**
 * `text` with every known credential secret cut out, so engagement search never matches on one. Each secret is
 * removed whole and, for `LM:NT`-style pairs, part by part; case-insensitively, since hashes are typed in either case.
 */
export function withoutSecrets(text: string, secrets: string[]): string {
  const pieces = new Set<string>();
  for (const s of secrets) {
    const t = s.trim();
    if (!t) continue;
    pieces.add(t);
    for (const part of t.split(":")) if (part.length >= 6) pieces.add(part);
  }
  if (pieces.size === 0 || !text) return text;
  // Longest first, so a whole pair goes before its halves.
  const re = new RegExp([...pieces].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"), "gi");
  return text.replace(re, " ");
}

/** Hosts first, then log entries, notes and credential labels. */
const ITEM_RANK: Record<EngagementItem["kind"], number> = { host: 0, log: 1, note: 2, credential: 3 };

/** The first `max` hits across the groups in order: the cap trims the tail and drops groups it empties; groups are never folded. */
export function capGroups(groups: ArsenalGroup[], max: number): ArsenalGroup[] {
  let left = max;
  const out: ArsenalGroup[] = [];
  for (const g of groups) {
    if (left <= 0) break;
    const hits = g.hits.slice(0, left);
    left -= hits.length;
    out.push({ ...g, hits });
  }
  return out;
}

/** How many Manual notes ⌘K lists. */
export const MANUAL_MAX = 8;

/** A lookup row's commands as library commands: they run from Kali and log as "{table}: {key}", as in the note. */
function lookupCommands(r: LookupRow): LibraryCommand[] {
  return r.commands.map((code, i) => {
    const c: LibraryCommand = {
      id: `lookup:${r.noteId}:${r.anchor}:${r.row}:${i}`, title: `${r.tableName}: ${r.key}`, tool: code.trim().split(/\s+/)[0] ?? "",
      template: code, os: "any", runFrom: "attacker", goals: [], source: "field-manual",
    };
    const exam = classifyExam(code);
    if (exam) c.exam = exam;
    return c;
  });
}

/** A lookup row as a ⌘K group, its commands under the same exam rules as the Arsenal's; null when none is left. */
function lookupGroup(r: LookupRow, ctx: PaletteContext): LookupGroup | null {
  let cmds = lookupCommands(r);
  let msfMarker = new Set<string>();
  if (ctx.exam) {
    const f = filterForKind(cmds, ctx.exam.kind, { hostId: ctx.exam.hostId, msfHostId: ctx.exam.msfHostId ?? null });
    cmds = f.shown;
    msfMarker = f.msfMarker;
  }
  if (cmds.length === 0) return null;
  return {
    key: `lookup-${r.noteId}-${r.anchor}-${r.row}`, code: r.key, text: plain(r.means).trim(),
    results: cmds.map((c) => ({ type: "command", id: c.id, title: c.template, command: c, msfMarker: msfMarker.has(c.id), lookup: { noteId: r.noteId, anchor: r.anchor, row: r.row } })),
  };
}

/**
 * Lookup rows matching the query, as groups (pending rules: none). The exam rules drop a row before the row cap counts
 * it, so a row left with no command never hides a later one that has some.
 */
function lookupGroups(query: string, ctx: PaletteContext): LookupGroup[] {
  if (ctx.examPending) return [];
  const groups = new Map<LookupRow, LookupGroup>();
  const keep = (r: LookupRow) => {
    const g = lookupGroup(r, ctx);
    if (g) groups.set(r, g);
    return g !== null;
  };
  return searchLookups(query, ctx.notes ?? [], undefined, keep).map((r) => groups.get(r)!);
}

/**
 * Lookup-table rows (their commands), Arsenal hits grouped by category, plus matching engagement items (log, notes, credential labels, hosts) and Manual
 * notes (title matches before body matches).
 */
export function searchPalette(
  query: string, ctx: PaletteContext,
): { lookups: LookupGroup[]; groups: ArsenalGroup[]; items: PaletteResult[]; manual: PaletteResult[] } {
  const groups = searchArsenal(query, ctx);
  const q = wordsOf(query);
  const items = (ctx.engagementItems ?? [])
    .filter((it) => matches(q, it.title, it.text))
    .sort((a, b) => ITEM_RANK[a.kind] - ITEM_RANK[b.kind])
    .map<PaletteResult>((it) => ({ type: "item", id: it.id, title: it.title, item: it }));
  const manual = searchManual(query, ctx.notes ?? [], MANUAL_MAX).map<PaletteResult>((h) => ({
    type: "manual", id: h.noteId, title: h.title, noteId: h.noteId, line: h.line, ...(h.anchor ? { anchor: h.anchor } : {}),
  }));
  return { lookups: lookupGroups(query, ctx), groups, items, manual };
}
