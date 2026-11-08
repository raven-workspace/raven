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

const stripProse = (s: string) =>
  s
    .replace(/<p\b[^>]*>[\s\S]*?<\/p>/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

/** Class-string regions: className="…", className={…}, cx(…) and template strings. */
function classRegions(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/className=("[^"]*"|\{[^}]*\})/g))
    out.push(m[1]);
  for (const m of src.matchAll(/\bcx\(([^)]*)\)/g)) out.push(m[1]);
  for (const m of src.matchAll(/`[^`]*`/g)) out.push(m[0]);
  return out;
}

export function breaks(rule: RuleId, file: string, src: string): boolean {
  switch (rule) {
    case "tiny-type":
      return /\btext-xs\b|text-\[\d+(\.\d+)?px\]/.test(src);
    case "feature-flex":
      return (
        file.startsWith("src/features/") &&
        classRegions(src).some((r) =>
          /\b(inline-)?flex\b|\bflex-(col|1|wrap)\b|\bjustify-between\b|\bgrow\b/.test(
            r,
          ),
        )
      );
    case "joined-strings":
      return / · | — | → /.test(stripProse(src));
    case "hand-hint":
      return (
        file !== "src/ui/HintLine.tsx" &&
        /<Kbd\b[\s\S]*<Kbd\b/.test(handHintExprs(src))
      );
    case "esc-close":
      return /<Kbd[^>]*>\s*esc\s*<\/Kbd>/i.test(src);
  }
}

/** Joins the JSX expressions that hold two or more Kbd; returns "" when none do. */
function handHintExprs(src: string): string {
  // A "JSX expression" here is a run of sibling Kbd tags separated only by
  // text, whitespace or other inline tags (no blank-line or block boundary).
  const m = src.match(/<Kbd\b[^]*?<\/Kbd>(?:(?!\n\s*\n)[^]){0,200}?<Kbd\b/);
  return m ? m[0] : "";
}
