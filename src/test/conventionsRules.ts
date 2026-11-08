import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { RuleId } from "./conventionsPending";

export const ROOT = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

export const files = [
  ...walk(join(ROOT, "src/features")),
  ...walk(join(ROOT, "src/ui")),
]
  .map((p) => relative(ROOT, p))
  .sort();

/** Drops block and line comments (a `//` right after `:` is a URL, so it stays). */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const stripProse = (s: string) =>
  stripComments(s.replace(/<p\b[^>]*>[\s\S]*?<\/p>/g, ""));

/** Text from just after `open` (index of "(") to its balanced ")". */
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/** A string literal that has the shape of a class list: space-separated utility-looking tokens. */
function looksLikeClassList(s: string): boolean {
  const toks = s.trim().split(/\s+/);
  if (toks[0] === "") return false;
  if (!toks.every((k) => /^[!\w\-:[\]/.,%#()&>*=+]+$/.test(k))) return false;
  const known =
    /^(flex|grow|block|hidden|grid|relative|absolute|fixed|sticky|truncate|contents|italic|underline)$/;
  return (
    toks.some((k) => /[-:[/]/.test(k)) ||
    (toks.length > 1 && toks.every((k) => known.test(k)))
  );
}

/**
 * Class-string regions: className="…", className={…}, cx(…) (balanced), template
 * strings, and any plain "…" / '…' literal shaped like a class list (so a
 * `const BOX = "inline-flex gap-2"` is seen wherever it is used). Prose and
 * command strings contain punctuation or a single word and are not class-shaped.
 */
function classRegions(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/className=("[^"]*"|\{[^}]*\})/g))
    out.push(m[1]);
  for (const m of src.matchAll(/\bcx\(/g))
    out.push(balanced(src, m.index + m[0].length - 1));
  for (const m of src.matchAll(/`[^`]*`/g)) out.push(m[0]);
  for (const m of src.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)) {
    const s = m[1] ?? m[2];
    if (looksLikeClassList(s)) out.push(s);
  }
  return out;
}

/**
 * hand-hint: two or more cap-variant <Kbd> as children of the same JSX parent,
 * or a cap <Kbd> rendered inside a `.map(` callback (one Kbd per array item).
 * `variant="inline"` Kbds are exempt (they live inside separate buttons).
 * Limits: a tag scanner, not a parser. Kbds split across a conditional
 * `{a && <Kbd/>}` still count in their parent; Kbds produced by a helper
 * component defined elsewhere are not seen.
 */
function handHint(src: string): boolean {
  const code = stripComments(src);
  const isCap = (tag: string) =>
    !/variant=(?:"inline"|\{\s*["']inline["']\s*\})/.test(tag);
  const stack: { name: string; kbds: number }[] = [{ name: "", kbds: 0 }];
  let i = 0;
  while (i < code.length) {
    if (code[i] !== "<") {
      i++;
      continue;
    }
    const prev = code[i - 1] ?? " ";
    const m = /^<(\/?)([A-Za-z][\w.]*)?/.exec(code.slice(i, i + 80));
    if (
      !m ||
      (!m[2] && m[1] !== "/" && code[i + 1] !== ">") ||
      (m[1] !== "/" && /[\w)\]]/.test(prev))
    ) {
      i++;
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2] ?? "";
    let j = i + m[0].length;
    // Skip attributes up to the tag's closing ">", honouring {…} and quotes.
    let depth = 0;
    let quote = "";
    for (; j < code.length; j++) {
      const c = code[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || (c === "`" && depth > 0)) quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth <= 0 && code[j - 1] !== "=") break;
    }
    const tag = code.slice(i, j + 1);
    const selfClosing = code[j - 1] === "/";
    if (closing) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
    } else {
      if (name === "Kbd" && isCap(tag) && ++stack[stack.length - 1].kbds >= 2)
        return true;
      if (!selfClosing) stack.push({ name, kbds: 0 });
    }
    i = j + 1;
  }
  // Cap Kbd rendered per item of an array.
  for (const m of code.matchAll(/\.map\(/g)) {
    const body = balanced(code, m.index + m[0].length - 1);
    for (const k of body.matchAll(/<Kbd\b(?:=>|[^>])*>/g))
      if (isCap(k[0])) return true;
  }
  return false;
}

export function breaks(rule: RuleId, file: string, src: string): boolean {
  switch (rule) {
    case "tiny-type":
      return /\btext-xs\b|text-\[\d+(\.\d+)?px\]/.test(stripComments(src));
    case "feature-flex":
      return (
        file.startsWith("src/features/") &&
        classRegions(stripComments(src)).some((r) =>
          /(?<![\w-])(inline-)?flex(?![\w-])|(?<![\w-])flex-(col|1|wrap)(?![\w-])|(?<![\w-])justify-between(?![\w-])|(?<![\w-])grow(?![\w-])/.test(
            r,
          ),
        )
      );
    case "joined-strings":
      return /\s(·|—|→|&middot;|&mdash;|&rarr;|\\u00B7|\\u2014|\\u2192|\\u\{(b7|2014|2192)\}|&#(183|8212|8594);|&#x(b7|2014|2192);)\s/i.test(
        stripProse(src),
      );
    case "hand-hint":
      return file !== "src/ui/HintLine.tsx" && handHint(src);
    case "esc-close":
      return /<Kbd\b(?:=>|[^>])*>\s*(?:esc|\{\s*["']esc["']\s*\})\s*<\/Kbd>/i.test(
        stripComments(src),
      );
  }
}
