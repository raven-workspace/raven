import type { CardMeta } from "../library/types";
import { cardForLink } from "../library/wikilinks";
import { slug } from "./anchors";
import type { ManualNote } from "./types";

export type LinkTarget = { kind: "note"; noteId: string; heading?: string } | { kind: "card"; cardId: string } | { kind: "none" };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const baseName = (path: string) => path.replace(/\.md$/i, "").split("/").pop() ?? path;

/**
 * Where a `[[link]]` goes: a Manual note first (by file name, id or title; case, spaces and dashes ignored), then a card
 * (`cardForLink`), else nowhere. `heading` (or a `#Heading` left in `target`) becomes the heading's anchor slug; a card
 * link drops it.
 */
export function resolveLink(target: string, notes: ManualNote[], cards: CardMeta[], heading?: string): LinkTarget {
  const hash = target.indexOf("#");
  const name = (hash >= 0 ? target.slice(0, hash) : target).trim();
  const head = heading ?? (hash >= 0 ? target.slice(hash + 1).trim() : undefined);
  const want = norm(baseName(name));
  if (want !== "") {
    const note =
      notes.find((n) => norm(baseName(n.file)) === want) ?? notes.find((n) => norm(n.id) === want) ?? notes.find((n) => norm(n.title) === want);
    if (note) {
      const anchor = head ? slug(head) : "";
      return anchor ? { kind: "note", noteId: note.id, heading: anchor } : { kind: "note", noteId: note.id };
    }
    const card = cardForLink(name, cards);
    if (card) return { kind: "card", cardId: card.id };
  }
  return { kind: "none" };
}
