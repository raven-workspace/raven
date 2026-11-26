/**
 * Canonical substitution context shared by every Raven shell/payload UI.
 *
 * Fields map onto the host, engagement and settings the command fill builds it
 * from, plus `shell` for reverse-shell templates.
 *
 * PRECEDENCE: when a target is actively engaged, its IP always wins over the
 * global RHOST. Callers build the context with both
 * `rhost` (the fallback) and `activeTargetIp` (the engaged machine's
 * IP, if any) and `resolveTemplate` picks `activeTargetIp || rhost`.
 */
export interface SubstitutionContext {
  lhost?: string;
  lport?: string;
  /** Fallback RHOST. Overridden by `activeTargetIp`. */
  rhost?: string;
  /** IP of the currently engaged target. Takes priority over `rhost` when present. */
  activeTargetIp?: string;
  /** Shell binary (e.g. `/bin/bash`), used only by the reverse-shell payload templates. */
  shell?: string;
  interface?: string;
  /** Lab/AD globals (`globalVars.domain` etc.). Empty values fall back to a same-named custom variable. */
  domain?: string;
  dcIp?: string;
  user?: string;
  cred?: string;
  wordlist?: string;
  customVars?: Record<string, string>;
}

export interface VariableRange {
  /** Character offset of the token's opening brace in the *original* template. */
  start: number;
  /** Character offset just past the token's closing brace. */
  end: number;
  /** Token name as written in the template (original case), e.g. `TARGET_IP` or `ip`. */
  raw: string;
  /** Canonical field name this token maps to, or `null` for unknown/unmapped tokens. */
  canonical: string | null;
  resolved: boolean;
}

export interface ResolveResult {
  /** The template with every resolvable token substituted. Unresolved tokens are left as-is. */
  text: string;
  /** De-duplicated list of unresolved variable labels (e.g. `['LHOST', 'DOMAIN']`). */
  unresolved: string[];
  ranges: VariableRange[];
}

// Known-field display defaults. These exist purely so copied/displayed text
// always reads as a real command instead of a bare `{LHOST}` — the variable
// still counts as unresolved (see below) whenever the underlying context
// value is missing or empty, regardless of this placeholder.
const DEFAULTS: Record<string, string> = {
  lhost: '10.10.14.X',
  lport: '4444',
  rhost: '10.10.10.X',
  interface: 'tun0',
  shell: '/bin/bash',
};

const CANONICAL_LABELS: Record<string, string> = {
  lhost: 'LHOST',
  lport: 'LPORT',
  rhost: 'TARGET_IP',
  interface: 'INTERFACE',
  shell: 'SHELL',
  domain: 'DOMAIN',
  dcIp: 'DC_IP',
  user: 'USER',
  cred: 'CRED',
  wordlist: 'WORDLIST',
};

/**
 * Upper-case token -> global field for the lab/AD globals. These have no display default; when the global is
 * empty a custom variable with the same token name (e.g. the default customVars.DOMAIN) still resolves it, so
 * templates that relied on customVars behave exactly as before.
 */
const GLOBAL_FIELD_ALIASES: Record<string, 'domain' | 'dcIp' | 'user' | 'cred' | 'wordlist'> = {
  DOMAIN: 'domain',
  DC_IP: 'dcIp',
  'DC-IP': 'dcIp',
  USER: 'user',
  CRED: 'cred',
  WORDLIST: 'wordlist',
};

/**
 * THE placeholder grammar: every part of Raven that spots placeholders (the Arsenal, the Manual, search, Payloads, the
 * checklist) goes through `findPlaceholders`, so they all agree on what one is. A conventions test fails if a
 * placeholder regex is defined anywhere else.
 *
 * A placeholder is `{TOKEN}`, the brace form library and Manual content is written in. It is never immediately preceded
 * by `$` or `%`, so `${VAR}` and curl's `%{http_code}` write-out are left untouched; `$(cmd)` and `%VAR%` use no braces
 * at all. `<name>` is never a placeholder: in commands it is XML or HTML (`<script>`, a .Library-ms file). A name is 2+
 * chars of letters, digits, `_` and `-`, so incidental single-char braces from other tools (e.g. PowerShell's `|%{0}`
 * foreach-object shorthand) are never mistaken for a token.
 */
const TOKEN_RE = /(?<![$%])\{([A-Za-z0-9_-]{2,})\}/g;

/** One `{NAME}` placeholder as written in a text. */
export interface Placeholder {
  /** Offset of the opening brace. */
  start: number;
  /** Offset just past the closing brace. */
  end: number;
  /** The name as written (original case), e.g. `TARGET_IP`, `ip` or `DC-IP`. */
  raw: string;
}

/** Every placeholder in `text`, in order. */
export function findPlaceholders(text: string): Placeholder[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length, raw: m[1] ?? '' }));
}

/** Whether `text` has at least one placeholder. */
export const hasPlaceholders = (text: string): boolean => findPlaceholders(text).length > 0;

/** `text` with each placeholder replaced by what `fn` returns for it; the text between is kept. */
export function replacePlaceholders(text: string, fn: (p: Placeholder) => string): string {
  let out = '';
  let last = 0;
  for (const p of findPlaceholders(text)) {
    out += text.slice(last, p.start) + fn(p);
    last = p.end;
  }
  return out + text.slice(last);
}

/**
 * The upper-case name a placeholder fills as, aliases folded the way `resolveTemplate` reads them: `{TARGET}`, `{IP}`,
 * `{TARGET-IP}` are TARGET_IP, `{DC-IP}` is DC_IP, and the exact-case payload aliases `{ip}`, `{port}`, `{shell}` are
 * LHOST, LPORT and SHELL. Any other name is upper-cased.
 */
export function canonicalToken(raw: string): string {
  const exact = EXACT_CASE_FIELDS.get(raw);
  if (exact) return CANONICAL_LABELS[exact]!;
  const upper = raw.toUpperCase();
  if (TARGET_ALIASES.has(upper)) return 'TARGET_IP';
  const field = GLOBAL_FIELD_ALIASES[upper];
  return field ? CANONICAL_LABELS[field]! : upper;
}

/** Secret tokens: the placeholders that hold a secret. Masked in the text shown and never an editable fill field. */
export const SECRET_TOKENS: ReadonlySet<string> = new Set(['PASS', 'HASH', 'CRED']);

/** Credential tokens: the placeholders filled from the chosen credential (DC_HOST carries the credential's domain). */
export const CREDENTIAL_TOKENS: ReadonlySet<string> = new Set(['USER', 'DOMAIN', 'PASS', 'HASH', 'DC_HOST']);

const TARGET_ALIASES = new Set(['TARGET_IP', 'TARGET', 'IP', 'TARGET-IP']);

/**
 * Exact-case (lowercase-only) aliases inherited from ReverseShellGenerator / revshellsData's payload library: `{ip}`,
 * `{port}`, `{shell}`, keyed to their field.
 */
const EXACT_CASE_FIELDS = new Map<string, 'lhost' | 'lport' | 'shell'>([['ip', 'lhost'], ['port', 'lport'], ['shell', 'shell']]);

function effectiveTarget(ctx: SubstitutionContext): string | undefined {
  return ctx.activeTargetIp || ctx.rhost;
}

/**
 * Exact-case (lowercase-only) aliases inherited from ReverseShellGenerator /
 * revshellsData's payload library: `{ip}`, `{port}`, `{shell}`. These are
 * checked BEFORE the case-insensitive TARGET_IP/IP family below so a literal
 * lowercase `{ip}` (attacker host, per revshellsData) never collides with
 * the case-insensitive `{IP}` alias for the target.
 */
function resolveExactCaseToken(
  raw: string,
  ctx: SubstitutionContext
): { value: string | undefined; canonical: string } | null {
  const field = EXACT_CASE_FIELDS.get(raw);
  return field ? { value: ctx[field], canonical: field } : null;
}

/** Case-insensitive aliases inherited from `helpers.ts#interpolateCommand`. */
function resolveKnownToken(
  upper: string,
  ctx: SubstitutionContext
): { value: string | undefined; canonical: string } | null {
  if (TARGET_ALIASES.has(upper)) return { value: effectiveTarget(ctx), canonical: 'rhost' };
  if (upper === 'LHOST') return { value: ctx.lhost, canonical: 'lhost' };
  if (upper === 'LPORT') return { value: ctx.lport, canonical: 'lport' };
  if (upper === 'INTERFACE') return { value: ctx.interface, canonical: 'interface' };
  return null;
}

function resolveGlobalFieldToken(
  raw: string,
  ctx: SubstitutionContext
): { value: string | undefined; canonical: string } | null {
  const field = GLOBAL_FIELD_ALIASES[raw.toUpperCase()];
  if (!field) return null;
  return { value: ctx[field] || resolveCustomVar(raw, ctx), canonical: field };
}

function resolveCustomVar(raw: string, ctx: SubstitutionContext): string | undefined {
  if (!ctx.customVars) return undefined;
  const key = Object.keys(ctx.customVars).find((k) => k.toLowerCase() === raw.toLowerCase());
  return key ? ctx.customVars[key] : undefined;
}

export interface ResolveOptions {
  /**
   * Disable the exact-case lowercase `{ip}`/`{port}`/`{shell}` aliases so the
   * engine behaves like the legacy `helpers.ts#interpolateCommand`, where
   * `{ip}` is case-insensitively the TARGET and `{port}`/`{shell}` are not
   * variables at all.
   */
  legacyAliases?: boolean;
}

/**
 * Resolve every `{TOKEN}` placeholder in `template` against
 * `context`. Pure function — same input always yields the same output.
 *
 * - Known fields (LHOST/LPORT/TARGET_IP family/INTERFACE/shell, plus their
 *   lowercase `{ip}`/`{port}`/`{shell}` aliases) are
 *   always substituted with the context value, or a readable default when
 *   the context value is empty — but an empty/missing value is still
 *   reported as unresolved.
 * - Custom variables (`globalVars.customVars`) are matched case-insensitively
 *   by key.
 * - Anything else is left untouched in the output and reported unresolved.
 * - Never substitutes inside `${VAR}` (bash/JS parameter expansion). `$(cmd)`
 *   and `%VAR%` contain no braces, so they are never touched.
 */
export function resolveTemplate(
  template: string,
  context: SubstitutionContext,
  options: ResolveOptions = {}
): ResolveResult {
  if (!template) return { text: '', unresolved: [], ranges: [] };

  const unresolvedSet = new Set<string>();
  const ranges: VariableRange[] = [];
  let result = '';
  let lastIndex = 0;

  for (const { start, end, raw } of findPlaceholders(template)) {
    const written = template.slice(start, end);
    result += template.slice(lastIndex, start);

    const known =
      (options.legacyAliases ? null : resolveExactCaseToken(raw, context)) ??
      resolveKnownToken(raw.toUpperCase(), context) ??
      resolveGlobalFieldToken(raw, context);

    if (known) {
      const { value, canonical } = known;
      if (value) {
        result += value;
        ranges.push({ start, end, raw, canonical, resolved: true });
      } else {
        result += DEFAULTS[canonical] ?? written;
        unresolvedSet.add(CANONICAL_LABELS[canonical] ?? canonical.toUpperCase());
        ranges.push({ start, end, raw, canonical, resolved: false });
      }
    } else {
      const customValue = resolveCustomVar(raw, context);
      if (customValue) {
        result += customValue;
        ranges.push({ start, end, raw, canonical: raw, resolved: true });
      } else {
        result += written;
        unresolvedSet.add(raw);
        ranges.push({ start, end, raw, canonical: null, resolved: false });
      }
    }

    lastIndex = end;
  }
  result += template.slice(lastIndex);

  return { text: result, unresolved: Array.from(unresolvedSet), ranges };
}
