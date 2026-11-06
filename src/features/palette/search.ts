import { filterForKind, HOST_GOALS, HOST_STAGES } from "../../engines/checklist";
import type { CardMeta } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import type { EngagementKind } from "../../types/engagement";

/** Something in the open engagement the palette can jump to. Credential items carry a label only, never a secret. */
export interface EngagementItem {
  id: string;
  kind: "log" | "note" | "credential";
  title: string;
  /** Extra searchable text (a log entry's commands, a note's body). Never a secret. */
  text: string;
}

export interface PaletteContext {
  library: LibraryCommand[];
  cards: CardMeta[];
  generators: { id: string; title: string }[];
  /** The host in view: its commands rank first. */
  os?: "linux" | "windows";
  stageId?: string;
  engagementItems?: EngagementItem[];
  /** Exam rules; absent means no engagement kind applies. */
  exam?: { kind: EngagementKind; hostId: string; msfHostId?: string | null };
  /** The engagement (so its exam rules) is not known yet: no commands are offered (fail closed). */
  examPending?: boolean;
}

export type PaletteResult =
  | { type: "command"; id: string; title: string; command: LibraryCommand; msfMarker: boolean }
  | { type: "generator"; id: string; title: string }
  | { type: "card"; id: string; title: string; card: CardMeta }
  | { type: "item"; id: string; title: string; item: EngagementItem };

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  const re = new RegExp([...pieces].sort((a, b) => b.length - a.length).map(escapeRe).join("|"), "gi");
  return text.replace(re, " ");
}

const STAGE_OF_GOAL = new Map(HOST_GOALS.map((g) => [g.id, g.stage]));
const STAGE_TITLE = new Map(HOST_STAGES.map((s) => [s.id, s.title]));

const wordsOf = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Every query word must be the start of some word in the fields. */
function matches(query: string[], ...fields: (string | undefined)[]): boolean {
  if (query.length === 0) return true;
  const words = fields.flatMap((f) => (f ? wordsOf(f) : []));
  return query.every((q) => words.some((w) => w.startsWith(q)));
}

function score(c: LibraryCommand, ctx: PaletteContext): number {
  let s = 0;
  if (ctx.os && c.os === ctx.os) s += 2;
  if (ctx.stageId && c.goals.some((g) => STAGE_OF_GOAL.get(g) === ctx.stageId)) s += 1;
  return s;
}

/** Commands, then generators, then cards, then engagement items; commands for the host's OS and stage first. */
export function searchPalette(query: string, ctx: PaletteContext): PaletteResult[] {
  const q = wordsOf(query);
  let pool = ctx.examPending ? [] : ctx.library;
  let msfMarker = new Set<string>();
  if (ctx.exam) {
    const f = filterForKind(pool, ctx.exam.kind, { hostId: ctx.exam.hostId, msfHostId: ctx.exam.msfHostId ?? null });
    pool = f.shown;
    msfMarker = f.msfMarker;
  }
  const commands = pool
    .filter((c) => matches(q, c.title, c.tool, c.template))
    .map((c, i) => ({ c, i, s: score(c, ctx) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map<PaletteResult>(({ c }) => ({ type: "command", id: c.id, title: c.title, command: c, msfMarker: msfMarker.has(c.id) }));
  const generators = ctx.generators
    .filter((g) => matches(q, g.title))
    .map<PaletteResult>((g) => ({ type: "generator", id: g.id, title: g.title }));
  const cards = ctx.cards
    // A vault folder is a category, never a stage: the stage and category are searched too.
    .filter((c) => matches(q, c.title, c.file, c.stage, STAGE_TITLE.get(c.stage), c.category))
    .map<PaletteResult>((c) => ({ type: "card", id: c.id, title: c.title, card: c }));
  const items = (ctx.engagementItems ?? [])
    .filter((it) => matches(q, it.title, it.text))
    .map<PaletteResult>((it) => ({ type: "item", id: it.id, title: it.title, item: it }));
  return [...commands, ...generators, ...cards, ...items];
}
