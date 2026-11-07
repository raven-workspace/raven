import { fillCommand } from "../../engines/checklist";
import type { FillInput } from "../../engines/checklist";

const TOKEN_RE = /(?<![$%])\{([A-Z][A-Z0-9_-]+)\}|<([A-Z][A-Z0-9_]+)>/g;
const TARGET_ALIASES = new Set(["TARGET", "IP", "TARGET-IP"]);
/** Never a field: they come from the picked credential and stay masked. */
export const SECRET_TOKENS = new Set(["PASS", "HASH", "CRED"]);

/** The editable fill tokens a set of templates uses, in first-seen order, aliases folded onto their canonical name. */
export function tokensOf(templates: string[]): string[] {
  const out = new Set<string>();
  for (const template of templates) {
    for (const m of template.matchAll(TOKEN_RE)) {
      let t = m[1] ?? m[2] ?? "";
      if (TARGET_ALIASES.has(t)) t = "TARGET_IP";
      if (t === "DC-IP") t = "DC_IP";
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

/** True when any template uses a token the credential chip fills. */
export const usesCred = (templates: string[]): boolean => templates.some((t) => /\{(USER|DOMAIN|PASS|HASH|CRED)\}|<(USER|DOMAIN|PASS|HASH|CRED)>/.test(t));
