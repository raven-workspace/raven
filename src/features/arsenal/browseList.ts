import type { ArsenalHit } from "../../engines/library/arsenalSearch";
import { categoryOf } from "../../engines/library/categories";
import type { CardMeta } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";

/** One block of pane 2: `heading` null is the cards block (cards, then generators); the others are a tool's card-less commands. */
export interface BrowseSection { heading: string | null; rows: ArsenalHit[] }

const byTitle = (a: ArsenalHit, b: ArsenalHit): number => a.title.localeCompare(b.title);

/**
 * What pane 2 lists for a category: its cards (alphabetical) with its generators, then the built-in commands that
 * belong to no card, under their tool's heading. Field-Manual commands live on their cards and never appear as rows.
 */
export function browseList(
  category: string,
  library: LibraryCommand[],
  cards: CardMeta[],
  generators: { id: string; title: string; category: string }[],
): BrowseSection[] {
  const top: ArsenalHit[] = [
    ...cards.filter((k) => k.category === category).map((card): ArsenalHit => ({ type: "card", id: card.id, title: card.title, card })).sort(byTitle),
    ...generators.filter((g) => g.category === category).map((g): ArsenalHit => ({ type: "generator", id: g.id, title: g.title, category: g.category })).sort(byTitle),
  ];
  const byTool = new Map<string, ArsenalHit[]>();
  for (const c of library) {
    if (c.cardId || c.source === "field-manual" || categoryOf(c, cards) !== category) continue;
    byTool.set(c.tool, [...(byTool.get(c.tool) ?? []), { type: "command", id: c.id, title: c.title, command: c, msfMarker: false }]);
  }
  const tools = [...byTool.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([heading, rows]): BrowseSection => ({ heading, rows: rows.sort(byTitle) }));
  return [...(top.length > 0 ? [{ heading: null, rows: top }] : []), ...tools];
}
