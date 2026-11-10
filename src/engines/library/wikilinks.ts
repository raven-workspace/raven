import type { CardMeta } from "./store";

/**
 * A piece of note text: plain text, or an Obsidian `[[link]]` (its target without `#heading`, the heading when there is
 * one, and what it shows).
 */
export type WikiPiece = { text: string } | { target: string; heading?: string; label: string };

const LINK = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]+))?\]\]/g;

/** Splits note text around `[[Target]]`, `[[Target#Heading]]` and `[[Target|alias]]`. */
export function splitWikilinks(text: string): WikiPiece[] {
  const out: WikiPiece[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    const target = m[1].trim();
    const heading = m[2]?.trim();
    out.push({ target, ...(heading ? { heading } : {}), label: (m[3] ?? target).trim() });
    at = m.index + m[0].length;
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at) });
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const baseName = (path: string) => path.replace(/\.md$/i, "").split("/").pop() ?? path;

/** The card a link points at: by its vault file name, else its title (case, spaces and dashes ignored). */
export function cardForLink(target: string, cards: CardMeta[]): CardMeta | undefined {
  const want = norm(baseName(target));
  return cards.find((c) => norm(baseName(c.file)) === want) ?? cards.find((c) => norm(c.title) === want);
}
