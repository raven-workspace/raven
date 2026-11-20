export const ABSOLUTE_WORDS = [
  "impossible",
  "not vulnerable",
  "fully secure",
  "completely secure",
  "cannot be exploited",
  "unexploitable",
];

/** The absolute claims in a text, lower-cased, each once per occurrence (whole words, case-insensitive). */
export function absoluteClaims(text: string): string[] {
  const found: { at: number; word: string }[] = [];
  for (const word of ABSOLUTE_WORDS) {
    const re = new RegExp(`(?<![\\w-])${word.replace(/ /g, "\\s+")}(?![\\w-])`, "gi");
    for (const m of text.matchAll(re)) found.push({ at: m.index ?? 0, word });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.word);
}

/** A leading "Affected: …" line (imported findings start their description with one). */
const AFFECTED = /^\s*Affected:[ \t]*([^\n]*)\n?/i;

/** A finding's description as the page tells it: the "Affected: …" line it may start with, apart from the explanation. */
export function splitAffected(description: string): { affected: string | null; explanation: string } {
  const m = AFFECTED.exec(description);
  if (!m) return { affected: null, explanation: description.trim() };
  return { affected: m[1].trim() || null, explanation: description.slice(m[0].length).trim() };
}

/** The first letter upper-cased, the rest as written. */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
