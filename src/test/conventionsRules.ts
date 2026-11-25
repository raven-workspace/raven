import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { RuleId } from "./conventionsPending";

export const ROOT = join(__dirname, "..", "..");

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.test(p) && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/**
 * Every file the rules read: .ts, .tsx and .scss under src/features and src/ui (constants and builders render too), the
 * app shell, and src/engines (.ts), which only the narrow engine joined-strings check applies to. The style rules
 * (tiny-type, feature-flex, unknown-color, off-scale-spacing) read the .scss; the markup rules read the rest.
 */
export const files = [
  ...walk(join(ROOT, "src/features"), /\.(tsx?|scss)$/),
  ...walk(join(ROOT, "src/ui"), /\.(tsx?|scss)$/),
  join(ROOT, "src/App.tsx"),
  ...walk(join(ROOT, "src/engines"), /\.ts$/),
]
  .map((p) => relative(ROOT, p))
  .sort();

const isEngine = (file: string) => file.startsWith("src/engines/");
const isStyle = (file: string) => file.endsWith(".scss");
const STYLE_RULES: RuleId[] = ["tiny-type", "feature-flex", "unknown-color", "off-scale-spacing"];

/** A spaced separator in a string's text: ` · `, ` — `, ` → `, or their \u escapes. */
const SPACED_SEPARATOR = /\s(·|—|→|\\u00B7|\\u2014|\\u2192)\s/i;

/**
 * The single- and double-quoted string literals in `code`, each with where it starts and ends. Template literals are
 * skipped whole (their `${…}` included), so a quote inside one is never read as a string; a string stops at its line's
 * end, so a stray quote (in a regex) costs at most that line.
 */
function quotedLiterals(code: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      out.push({ start: i, end: j + 1, text: code.slice(i + 1, j) });
      i = j + 1;
    } else if (c === "`") {
      let j = i + 1;
      let depth = 0;
      while (j < code.length && !(depth === 0 && code[j] === "`")) {
        if (code[j] === "\\" || (code[j] === "$" && code[j + 1] === "{")) {
          if (code[j] === "$") depth++;
          j++;
        } else if (depth > 0 && code[j] === "}") depth--;
        j++;
      }
      i = j + 1;
    } else i++;
  }
  return out;
}

/**
 * Engines hold prose (field manual, playbook text) where a dash or arrow is punctuation. A separator is a joined
 * structured value only when it glues values together: touching a `${…}` interpolation in a template literal
 * (`${host} — no foothold`), or in a string concatenated with `+` (`a + " — " + b`) or passed to `.join(…)`
 * (`parts.join(" · ")`).
 */
function engineJoined(src: string): boolean {
  const code = stripComments(src);
  for (const m of code.matchAll(/`(?:[^`\\]|\\.)*`/g)) {
    if (/\}\s+(·|—|→)\s|\s(·|—|→)\s+\$\{/.test(m[0])) return true;
  }
  for (const lit of quotedLiterals(code)) {
    if (!SPACED_SEPARATOR.test(lit.text)) continue;
    // What touches the string on either side (a short window: enough for `.join(` and a `+`).
    const before = code.slice(Math.max(0, lit.start - 40), lit.start).trimEnd();
    const after = code.slice(lit.end, lit.end + 40).trimStart();
    if (before.endsWith("+") || after.startsWith("+")) return true;
    if (/\.join\(\s*$/.test(before) && after.startsWith(")")) return true;
  }
  return false;
}

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

/** The declarations of a stylesheet, in order: `[property, value]`, with any `!important` left on the value. */
export function declarations(scss: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of stripComments(scss).matchAll(/(?:^|[;{}])\s*(--[\w-]+|-?[a-z][a-z-]*)\s*:\s*([^;{}]*?)\s*;/gm))
    out.push([m[1], m[2]]);
  return out;
}

/** The type roles in tokens.css (`--text-<role>`): the only font sizes. */
const TYPE_ROLES = new Set(
  [...readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8").matchAll(/--text-([\w-]+?):/g)].map((m) => m[1]),
);

/** A font size that is not a type role (`var(--text-meta)`); `inherit` and `1em` keep the parent's role. */
function offRoleSize(scss: string): string[] {
  return declarations(scss)
    .filter(([p, v]) => p === "font-size" || (p === "font" && v !== "inherit"))
    .filter(([p, v]) => {
      if (p === "font") return true;
      const role = /^var\(--text-([\w-]+)\)$/.exec(v);
      return !(role && TYPE_ROLES.has(role[1])) && !/^(inherit|1em)$/.test(v);
    })
    .map(([p, v]) => `${p}: ${v}`);
}

/** Flex as feature layout (DESIGN.md's grid rule): a flex container, its direction or wrapping, growth, space-between. */
function featureFlex(scss: string): string[] {
  return declarations(scss)
    .filter(
      ([p, v]) =>
        (p === "display" && /^(inline-)?flex\b/.test(v)) ||
        p === "flex-direction" ||
        p === "flex-wrap" ||
        p === "flex-flow" ||
        p === "flex-grow" ||
        (p === "flex" && !/^0\b|^none$/.test(v)) ||
        (p === "justify-content" && /space-between/.test(v)),
    )
    .map(([p, v]) => `${p}: ${v}`);
}

/** Every custom property the token sheets declare. */
const DECLARED_VARS = new Set(
  ["src/styles/tokens.css", "src/styles/global.css"].flatMap((f) =>
    [...readFileSync(join(ROOT, f), "utf8").matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
  ),
);

let localVarsCache: Set<string> | undefined;
/**
 * Custom properties the checked files define themselves (`--sidebar-width: 240px;` in a sheet, `"--pane-bg"` in a
 * style object or a `setProperty("--head-h", …)`), so a component can read a variable its block or a parent sets. Their values are checked where set.
 */
function localVars(): Set<string> {
  localVarsCache ??= new Set(
    files.flatMap((f) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      return isStyle(f)
        ? declarations(src).flatMap(([p]) => (p.startsWith("--") ? [p] : []))
        : [...src.matchAll(/["'](--[\w-]+)["']\s*[:,]/g)].map((m) => m[1]);
    }),
  );
  return localVarsCache;
}

/** CSS named colours a hand-written value might use (the common ones; tokens are the only colours allowed). */
const NAMED_COLORS =
  /^(red|green|blue|white|black|gray|grey|orange|yellow|purple|pink|brown|cyan|magenta|lime|navy|teal|maroon|olive|silver|gold|indigo|violet|crimson|coral|salmon|tomato|aqua|fuchsia|beige|khaki|ivory|lavender|turquoise|tan|orchid|plum|chocolate|firebrick|darkred|darkgreen|darkblue|lightgray|lightgrey|darkgray|darkgrey)$/i;

/** Properties whose value can carry a colour by name. */
const COLOUR_PROP = /color|background|border|outline|shadow|fill|stroke|caret|accent|decoration|column-rule|^--/;

/** A raw colour in a value: hex, a colour function, or (in a colour property) a named colour. url(…) is skipped. */
function rawColours(prop: string, value: string): string[] {
  const v = value.replace(/url\([^)]*\)/g, "");
  const found = [
    ...v.matchAll(/#[\da-f]{3,8}(?![\w-])/gi),
    ...v.matchAll(/(?:^|[^\w-])((?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^)]*\))/gi),
  ].map((m) => (m[1] ?? m[0]).trim());
  if (COLOUR_PROP.test(prop)) found.push(...v.split(/[\s,()/]+/).filter((w) => NAMED_COLORS.test(w)));
  return found;
}

/** Black is darkness, not a palette colour: a shadow's or an alpha mask's black is allowed. */
const BLACK = /^(#000(000)?|black|rgba?\(\s*0[\s,]+0[\s,]+0\b[^)]*\))$/i;
const DARKNESS_PROP = /^(box-shadow|mask|mask-image|-webkit-mask|-webkit-mask-image)$/;

/** Colours that are not tokens: raw colours anywhere, and var(--x) references nothing declares. */
function unknownColors(scss: string): string[] {
  const bad: string[] = [];
  const local = localVars();
  for (const [p, v] of declarations(scss)) {
    for (const c of rawColours(p, v)) if (!(DARKNESS_PROP.test(p) && BLACK.test(c))) bad.push(`${p}: ${c}`);
    for (const m of v.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const name = m[1];
      if (!DECLARED_VARS.has(name) && !local.has(name) && !name.startsWith("--radix-")) bad.push(`${p}: ${name}`);
    }
  }
  return bad;
}

/** One spacing value on DESIGN.md's scale: a `--space-*` token (or its negative), 0, auto, or a 1px hairline offset. */
const ON_SCALE = /^(0|auto|-?1px|inherit|initial|var\(--space-[\w]+\)|calc\(var\(--space-[\w]+\) \* -1\)|calc\(-1 \* var\(--space-[\w]+\)\))$/;
const SPACING_PROP = /^(padding|margin)(-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$|^(gap|row-gap|column-gap)$/;
/** The documented exceptions, per file: the exact declarations allowed off the scale, and why. */
const SPACING_ALLOWED: Record<string, { declarations: string[]; reason: string }> = {
  "src/ui/HintLine.scss": { declarations: ["gap: 6px"], reason: "the hint key-to-label gap is 6px (DESIGN.md)" },
  "src/ui/TitleBar.scss": {
    declarations: ["padding-left: 94px"],
    reason: "window chrome: the macOS traffic lights' 78px clearance (titleBarStyle Overlay) plus 16px of air, not a spacing step",
  },
  "src/features/network/InterfaceNudge/InterfaceNudge.scss": {
    declarations: ["margin-block: -0.125rem"],
    reason: "the inline subnet is a 24px target in a 20px line: -2px above and below keep the line from growing, not a spacing step",
  },
};

/** A value's space-separated parts, a parenthesised group (a calc()) staying one part. */
function spaceParts(value: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (const c of value) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (/\s/.test(c) && depth === 0) {
      if (cur) parts.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Padding, margin and gap values off the 4/8/12/16/24/32 scale. */
function offScaleSpacing(file: string, scss: string): string[] {
  const allowed = SPACING_ALLOWED[file]?.declarations ?? [];
  return declarations(scss)
    .filter(([p]) => SPACING_PROP.test(p))
    .map(([p, v]) => `${p}: ${v.replace(/\s*!important$/, "")}`)
    .filter((d) => !allowed.includes(d))
    .filter((d) => {
      const value = d.slice(d.indexOf(":") + 1).trim();
      return !spaceParts(value).every((part) => ON_SCALE.test(part));
    });
}

/** The one module allowed to define the placeholder grammar. */
export const PLACEHOLDER_GRAMMAR = "src/engines/checklist/template.ts";

/** App source the placeholder rule reads: every .ts and .tsx under src, tests excepted. */
export const sourceFiles = walk(join(ROOT, "src"), /\.tsx?$/)
  .map((p) => relative(ROOT, p))
  .filter((f) => !f.startsWith("src/test/"))
  .sort();

/**
 * A regex that spots placeholders, in a regex literal or a `RegExp` string: `\{` (or `\\{`) then a name class or group
 * (`\{[A-Z`, `\{(FILE|SCRIPT)`, `\{\w`), an escaped literal name (`\{LPORT\}`), or an angle form (`<([A-Z`, `<\w`),
 * which the grammar dropped and must not come back elsewhere.
 * Neither a Windows path in a string (`C:\\tmp\\{FILE}`: its closing brace is not escaped) nor a CSS rule (`\.a \{[^}]`)
 * counts.
 */
const PLACEHOLDER_REGEX =
  /\\{1,2}\{\(?(?:\[(?:A-Z|a-z|\\{1,2}w)|\\{1,2}w|[A-Z][A-Z0-9_|]*(?:\)|\\{1,2}\}))|<\(?(?:\[(?:A-Z|a-z)|\\{1,2}w)/;

/** The code lines of `src` (comments aside) that define a placeholder regex. */
export function placeholderRegexes(src: string): string[] {
  return stripComments(src)
    .split("\n")
    .filter((line) => PLACEHOLDER_REGEX.test(line))
    .map((line) => line.trim());
}

export function breaks(rule: RuleId, file: string, src: string): boolean {
  // Engines render no markup: only the narrow joined-strings check reads them.
  if (isEngine(file)) return rule === "joined-strings" && engineJoined(src);
  // Style rules read stylesheets; markup rules read everything else.
  if (STYLE_RULES.includes(rule) !== isStyle(file)) return false;
  switch (rule) {
    case "tiny-type":
      return offRoleSize(src).length > 0;
    case "feature-flex":
      return file.startsWith("src/features/") && featureFlex(src).length > 0;
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

/** The library store. Engines take the command library as an argument and never import it (RAV-49). */
export const LIBRARY_STORE = "src/engines/library/store.ts";

/** Every .ts module under src/engines but the library store itself. */
export const engineFiles = sourceFiles.filter((f) => isEngine(f) && f !== LIBRARY_STORE);

/** The module specifiers `src` imports or re-exports: static, side-effect and dynamic imports, comments aside. */
function specifiers(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  for (const m of code.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) out.push(m[1]!);
  return out;
}

/** True when `file` imports the library store, by a relative path or the `@/` alias, with or without an extension. */
export function importsLibraryStore(file: string, src: string): boolean {
  const target = LIBRARY_STORE.replace(/\.ts$/, "");
  return specifiers(src).some((spec) => {
    const path = spec.startsWith("@/") ? join("src", spec.slice(2)) : spec.startsWith(".") ? join(dirname(file), spec) : null;
    return path !== null && path.replace(/\.[jt]s$/, "") === target;
  });
}

export { unknownColors, offScaleSpacing, featureFlex, offRoleSize };
