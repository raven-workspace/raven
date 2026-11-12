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

/** A line ending in a common abbreviation ("e.g.", "etc."): its full stop doesn't end the sentence. */
const ENDS_IN_ABBREVIATION = /(?:^|[\s(,;])(?:e\.g|i\.e|etc|vs|cf|approx|incl|esp|viz|a\.k\.a|et al)\.$/i;

/** One fix step per item: blank lines, bullets ("-", "*", "•", "1.") and a line that ends a sentence start a new one;
 *  a line broken mid-sentence (or after "e.g.", "etc." and the like) carries on the same step. */
export function fixSteps(remediation: string): string[] {
  const steps: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) steps.push(current.join(" "));
    current = [];
  };
  for (const raw of remediation.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") {
      flush();
      continue;
    }
    const bullet = /^(?:[-*•]|\d+[.)])\s+/.exec(line);
    if (bullet) flush();
    current.push(bullet ? line.slice(bullet[0].length) : line);
    if (/[.!?]$/.test(line) && !ENDS_IN_ABBREVIATION.test(line)) flush();
  }
  flush();
  return steps;
}
