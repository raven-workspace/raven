import { canonicalToken, fillCommand, findPlaceholders, SECRET_TOKENS } from "../../engines/checklist";
import type { FillInput } from "../../engines/checklist";

/** The editable fill tokens a set of templates uses, in first-seen order, aliases folded onto their canonical name. Secret tokens are never a field. */
export function tokensOf(templates: string[]): string[] {
  const out = new Set<string>();
  for (const template of templates) {
    for (const p of findPlaceholders(template)) {
      const t = canonicalToken(p.raw);
      if (!SECRET_TOKENS.has(t)) out.add(t);
    }
  }
  return [...out];
}

/** What each token fills with on its own, ignoring what the user typed (`input.overrides` is dropped). */
export function autoFill(tokens: string[], input: FillInput): Record<string, { text: string; unresolved: boolean; dcByName?: boolean }> {
  const out: Record<string, { text: string; unresolved: boolean; dcByName?: boolean }> = {};
  for (const t of tokens) {
    const r = fillCommand(`{${t}}`, { ...input, overrides: {} });
    out[t] = { text: r.unresolved.length > 0 ? "" : r.text, unresolved: r.unresolved.length > 0, ...(r.dcByName ? { dcByName: true } : {}) };
  }
  return out;
}
