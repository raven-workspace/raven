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
