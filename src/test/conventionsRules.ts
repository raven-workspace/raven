import { readdirSync, readFileSync, statSync } from "node:fs";
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

/**
 * shadcn's semantic colour names (src/ui/shadcn). Each is an alias of an Ink token, declared in
 * global.css's "shadcn aliases" block (checked by src/test/ui/shadcnTheme.test.ts).
 */
export const SHADCN_COLORS = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground", "muted-foreground",
  "accent-foreground", "destructive", "border", "input", "ring",
  "sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
];

/** The colour names tokens.css defines under `--color-*` (the rest of Tailwind's palette is reset). */
const TOKEN_COLORS = new Set([
  ...[
    ...readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8").matchAll(
      /--color-([\w-]+):/g,
    ),
  ].map((m) => m[1]),
  ...SHADCN_COLORS,
  "transparent",
  "current",
  "inherit",
]);

/** Per colour prefix, the values that are NOT colours (sizes, widths, alignment, roles, modes). */
const NON_COLOR: Record<string, RegExp> = {
  text:
    /^(title|heading|body|code|meta|label|xs|sm|base|lg|\d*xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|shadow-.*)$/,
  border:
    /^(\d+|[xytblrse](-\d+)?|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing-.*)$/,
  outline: /^(\d+|none|dashed|dotted|double|hidden|solid|offset-.*)$/,
  ring: /^(\d+|inset|offset-.*)$/,
  bg: /^(fixed|local|scroll|clip-.*|origin-.*|repeat.*|no-repeat|cover|contain|auto|center|top|bottom|left|right|none|blend-.*|linear-.*|radial.*|conic.*|gradient-.*|(left|right|top|bottom)(-(top|bottom|left|right))?)$/,
  fill: /^none$/,
  stroke: /^(\d+|none)$/,
  divide: /^(\d+|[xy](-\d+)?|reverse|solid|dashed|dotted|double|none)$/,
  placeholder: /^$/,
  from: /^\d+%$/,
  via: /^\d+%$/,
  to: /^\d+%$/,
};

/** Splits a class region into tokens; `(`, `)` and `,` separate tokens only outside `[…]`. */
function classTokens(region: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let parens = 0;
  for (const c of region) {
    if (c === "[") depth++;
    else if (c === "]") depth = Math.max(0, depth - 1);
    // Tailwind 4's `bg-(--x,var(--y))`: a "(" right after "-" opens a value, not a call.
    else if (c === "(" && depth === 0 && (parens > 0 || cur.endsWith("-"))) parens++;
    else if (c === ")" && depth === 0 && parens > 0) {
      parens--;
      cur += c;
      continue;
    }
    if (/[\s"'`{}]/.test(c) || (depth === 0 && parens === 0 && /[(),]/.test(c))) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** Every custom property the stylesheets declare (tokens, shadcn aliases, sidebar vars). */
const DECLARED_VARS = new Set(
  ["src/styles/tokens.css", "src/styles/global.css"].flatMap((f) =>
    [...readFileSync(join(ROOT, f), "utf8").matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
  ),
);

/** CSS named colours a hand-written value might use (the common ones; tokens are the only colours allowed). */
const NAMED_COLORS =
  /^(red|green|blue|white|black|gray|grey|orange|yellow|purple|pink|brown|cyan|magenta|lime|navy|teal|maroon|olive|silver|gold|indigo|violet|crimson|coral|salmon|tomato|aqua|fuchsia|beige|khaki|ivory|lavender|turquoise|tan|orchid|plum|chocolate|firebrick|darkred|darkgreen|darkblue|lightgray|lightgrey|darkgray|darkgrey)$/i;

/** A raw colour inside an arbitrary value: hex, a colour function or a named colour, anywhere in it. */
function rawColour(value: string): boolean {
  if (/#[\da-f]{3,8}(?![\w-])/i.test(value)) return true;
  if (/(?:^|[^\w-])(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color|color-mix)\(/i.test(value)) return true;
  return value.split(/[\s_,()[\]:/]+/).some((w) => NAMED_COLORS.test(w));
}

/** var(--x) references in a value that are neither declared in the stylesheets nor defined locally from tokens. */
function unknownVars(value: string, local: Set<string>): boolean {
  const refs = [...value.matchAll(/var\((--[\w-]+)/g), ...value.matchAll(/^\(?(--[\w-]+)/g)].map((m) => m[1]);
  return refs.some((v) => !DECLARED_VARS.has(v) && !local.has(v));
}

/** Custom properties a class list defines (`[--pane-bg:var(--bg)]`). Their values are checked where they are defined. */
function varsDefinedIn(toks: string[]): string[] {
  return toks.flatMap((t) => {
    const p = /^\[(--[\w-]+):(.*)\]$/.exec(stripVariants(t));
    return p ? [p[1]] : [];
  });
}

let projectVarsCache: Set<string> | undefined;
/** Custom properties defined in any checked file, so a pane's `--pane-bg` can be read by the components inside it. */
function projectVars(): Set<string> {
  projectVarsCache ??= new Set(
    files.flatMap((f) => varsDefinedIn(classRegions(stripComments(readFileSync(join(ROOT, f), "utf8"))).flatMap(classTokens))),
  );
  return projectVarsCache;
}

const COLOUR_PREFIX = "bg|text|border(?:-[xytblrse])?|outline|ring|fill|stroke|divide|placeholder|from|via|to|decoration|shadow|accent|caret";

/**
 * Colour utilities (any variant, optional /opacity) whose colour is not a tokens.css token, and hand-written colours in
 * arbitrary values (`bg-[#123]`, `bg-[red]`, `shadow-[0_0_0_1px_#fff]`, `bg-[var(--unknown)]`, `bg-(--unknown)`) or
 * arbitrary properties (`[color:#123]`). A local custom property (`[--pane-bg:var(--bg)]`) may be used once it is defined
 * from tokens.
 */
function unknownColors(src: string): string[] {
  const bad: string[] = [];
  const toks = classRegions(stripComments(src)).flatMap(classTokens);
  const local = new Set([...projectVars(), ...varsDefinedIn(toks)]);
  for (const t of toks) {
    const base = stripVariants(t);
    const prop = /^\[([\w-]+):(.*)\]$/.exec(base);
    if (prop) {
      const [, name, value] = prop;
      const colourProp = name.startsWith("--") || /color|background|border|fill|stroke|outline|shadow|caret|accent/.test(name);
      if (colourProp && (rawColour(value) || unknownVars(value, local))) bad.push(t);
      continue;
    }
    const arb = new RegExp(`^(${COLOUR_PREFIX})-(\\[[^\\]]*\\]|\\([^)]*\\)+)(?:/[\\w.[\\]%]+)?$`).exec(base);
    if (arb) {
      const inner = arb[2].slice(1, -1);
      if (rawColour(inner) || unknownVars(inner, local)) bad.push(t);
      continue;
    }
    const m = /^(bg|text|border|outline|ring|fill|stroke|divide|placeholder|from|via|to)-([^[/(]+)(?:\/[\w.[\]%]+)?$/.exec(
      base,
    );
    if (!m) continue;
    const [, prefix, raw] = m;
    // Per-side border colours (border-l-accent) name the colour after the side.
    const v = prefix === "border" ? raw.replace(/^[xytblrse]-(?=[a-z])/, "") : raw;
    if (TOKEN_COLORS.has(v) || NON_COLOR[prefix].test(v) || NON_COLOR[prefix].test(raw)) continue;
    bad.push(t);
  }
  return bad;
}

/** Spacing steps DESIGN.md allows: 0, 1 (4px), 2 (8), 3 (12), 4 (16), 6 (24), 8 (32), plus px/auto. */
const SPACING_STEPS = new Set(["0", "1", "2", "3", "4", "6", "8", "px", "auto"]);
const SPACING_UTIL =
  /^-?(?:gap-x|gap-y|space-x|space-y|gap|px|py|pt|pr|pb|pl|ps|pe|p|mx|my|mt|mr|mb|ml|ms|me|m)-(.+)$/;
/** The documented exceptions, per file: the exact utilities allowed off the scale, and why. */
const SPACING_ALLOWED: Record<string, { tokens: string[]; reason: string }> = {
  "src/ui/HintLine.tsx": { tokens: ["gap-[6px]"], reason: "the hint key-to-label gap is 6px (DESIGN.md)" },
  "src/ui/TitleBar.tsx": {
    tokens: ["pl-[78px]", "pl-[max(78px,calc((100%_-_var(--col-max))/2_+_var(--col-inset)))]"],
    reason: "window chrome: the 78px left clearance for the macOS traffic lights (titleBarStyle Overlay), not a spacing step",
  },
};

/** Drops the variant prefixes (`md:`, `group-data-[x=y]:`, `[&>svg]:`): everything up to the last top-level colon. */
function stripVariants(t: string): string {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "[" || t[i] === "(") depth++;
    else if (t[i] === "]" || t[i] === ")") depth--;
    else if (t[i] === ":" && depth === 0) cut = i;
  }
  return t.slice(cut + 1).replace(/^!/, "").replace(/!$/, "");
}

/** Padding, margin, gap and space utilities off the 4/8/12/16/24/32 scale (0.5, 1.5, 2.5, 3.5, 5, 7, arbitrary px). */
function offScaleSpacing(file: string, src: string): string[] {
  const allowed = SPACING_ALLOWED[file]?.tokens ?? [];
  const bad: string[] = [];
  const toks = classRegions(stripComments(src)).flatMap(classTokens);
  for (const t of toks) {
    const m = SPACING_UTIL.exec(stripVariants(t));
    if (!m) continue;
    const v = m[1];
    if (SPACING_STEPS.has(v) || allowed.includes(stripVariants(t))) continue;
    const arbitrary = /^\[(-?[\d.]+)(px|rem|em)?\]$/.exec(v);
    // Inside an arbitrary expression (max(), calc()) any non-zero length is off the scale.
    const lengthInside = v.startsWith("[") && /(?<![A-Za-z0-9.-])(?!0(?:px|rem|em)\b)[\d.]+(px|rem|em)\b/.test(v);
    if (arbitrary ? Number(arbitrary[1]) !== 0 : lengthInside || /^\d+(\.\d+)?$/.test(v)) bad.push(t);
  }
  return bad;
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
      return (
        /\s(·|—|→|&middot;|&mdash;|&rarr;|\\u00B7|\\u2014|\\u2192|\\u\{(b7|2014|2192)\}|&#(183|8212|8594);|&#x(b7|2014|2192);)\s/i.test(
          stripProse(src),
        ) ||
        // A separator between two expressions is a joined string even inside <p>: `{a} · {b}`.
        /\}\s+(·|—|→|&middot;|&mdash;|&rarr;)\s+\{/i.test(stripComments(src))
      );
    case "hand-hint":
      return file !== "src/ui/HintLine.tsx" && handHint(src);
    case "unknown-color":
      return unknownColors(src).length > 0;
    case "off-scale-spacing":
      return offScaleSpacing(file, src).length > 0;
    case "esc-close":
      return /<Kbd\b(?:=>|[^>])*>\s*(?:esc|\{\s*["']esc["']\s*\})\s*<\/Kbd>/i.test(
        stripComments(src),
      );
  }
}

export { unknownColors, offScaleSpacing };
