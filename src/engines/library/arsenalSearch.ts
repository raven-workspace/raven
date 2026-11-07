import { filterForKind } from "../checklist";
import type { EngagementKind } from "../../types/engagement";
import { CATEGORY_ALIASES, categoryLabel, categoryOf } from "./categories";
import type { CardMeta } from "./store";
import type { LibraryCommand } from "./types";

export type ArsenalHit =
  | { type: "command"; id: string; title: string; command: LibraryCommand; msfMarker: boolean }
  | { type: "card"; id: string; title: string; card: CardMeta }
  | { type: "generator"; id: string; title: string; category: string };

export interface ArsenalGroup {
  category: string;
  label: string;
  hits: ArsenalHit[];
}

export interface ArsenalContext {
  library: LibraryCommand[];
  cards: CardMeta[];
  generators: { id: string; title: string; category: string }[];
  /** Exam rules; absent means no engagement kind applies. */
  exam?: { kind: EngagementKind; hostId: string; msfHostId?: string | null };
  /** The engagement (so its exam rules) is not known yet: no commands are offered (fail closed). */
  examPending?: boolean;
}

/** Field weights: a hit scores the highest field it matched. */
const W_TITLE = 8;
const W_TAGS = 4;
const W_CATEGORY = 2;
const W_BODY = 1;

export const wordsOf = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Every query word must be the start of some word in the fields. */
export function matches(query: string[], ...fields: (string | undefined)[]): boolean {
  if (query.length === 0) return true;
  const words = fields.flatMap((f) => (f ? wordsOf(f) : []));
  return query.every((q) => words.some((w) => w.startsWith(q)));
}

type Field = [weight: number, text: string];

/** null when some query word matches no field; else the weight of the best field any word matched. */
function scoreOf(q: string[], fields: Field[]): number | null {
  if (q.length === 0) return 0;
  const words = fields.map(([w, t]) => [w, wordsOf(t)] as const);
  let best = 0;
  for (const word of q) {
    let wordBest = 0;
    for (const [weight, ws] of words) if (weight > wordBest && ws.some((x) => x.startsWith(word))) wordBest = weight;
    if (wordBest === 0) return null;
    best = Math.max(best, wordBest);
  }
  return best;
}

const categoryText = (slug: string): string => [slug, categoryLabel(slug), ...(CATEGORY_ALIASES[slug] ?? [])].join(" ");

/** One relevance search over commands, cards and generators, grouped by category. */
export function searchArsenal(query: string, ctx: ArsenalContext): ArsenalGroup[] {
  const q = wordsOf(query);
  // Pending exam rules fail closed for commands only; cards and generators carry no exam rules.
  let pool = ctx.examPending ? [] : ctx.library;
  let msfMarker = new Set<string>();
  if (ctx.exam) {
    const f = filterForKind(pool, ctx.exam.kind, { hostId: ctx.exam.hostId, msfHostId: ctx.exam.msfHostId ?? null });
    pool = f.shown;
    msfMarker = f.msfMarker;
  }
  const scored: { category: string; score: number; hit: ArsenalHit }[] = [];
  for (const c of pool) {
    const category = categoryOf(c, ctx.cards);
    const score = scoreOf(q, [[W_TITLE, c.title], [W_TAGS, [c.tool, ...(c.tags ?? [])].join(" ")], [W_CATEGORY, categoryText(category)], [W_BODY, c.template]]);
    if (score !== null) scored.push({ category, score, hit: { type: "command", id: c.id, title: c.title, command: c, msfMarker: msfMarker.has(c.id) } });
  }
  for (const k of ctx.cards) {
    const score = scoreOf(q, [[W_TITLE, k.title], [W_TAGS, k.stage], [W_CATEGORY, categoryText(k.category)], [W_BODY, k.file]]);
    if (score !== null) scored.push({ category: k.category, score, hit: { type: "card", id: k.id, title: k.title, card: k } });
  }
  for (const g of ctx.generators) {
    const score = scoreOf(q, [[W_TITLE, g.title], [W_CATEGORY, categoryText(g.category)]]);
    if (score !== null) scored.push({ category: g.category, score, hit: { type: "generator", id: g.id, title: g.title, category: g.category } });
  }
  const byCategory = new Map<string, { score: number; hit: ArsenalHit }[]>();
  for (const s of scored) byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s]);
  return [...byCategory.entries()]
    .map(([category, list]) => {
      list.sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title));
      return { category, label: categoryLabel(category), best: list[0]!.score, hits: list.map((l) => l.hit) };
    })
    .sort((a, b) => b.best - a.best || a.label.localeCompare(b.label))
    .map(({ category, label, hits }) => ({ category, label, hits }));
}
