export type QuoteContext = 'bare' | 'single' | 'double';

interface Frame {
  q: QuoteContext;
  /** A `$(…)` body: a closing `)` at depth 0 ends it. */
  sub: boolean;
  depth: number;
}

function scan(template: string, end: number): { ctx: QuoteContext; unmodelled: boolean } {
  const stack: Frame[] = [{ q: 'bare', sub: false, depth: 0 }];
  let unmodelled = false;
  for (let i = 0; i < end; i++) {
    const top = stack[stack.length - 1];
    const ch = template[i];
    if (top.q === 'single') {
      if (ch === "'") top.q = 'bare';
    } else if (ch === '\\') {
      i++;
    } else if (ch === '`') {
      unmodelled = true;
    } else if (ch === '$' && template[i + 1] === '(') {
      stack.push({ q: 'bare', sub: true, depth: 0 });
      i++;
    } else if (top.q === 'double') {
      if (ch === '"') top.q = 'bare';
    } else if (ch === '$' && template[i + 1] === "'") {
      unmodelled = true;
    } else if (ch === "'") top.q = 'single';
    else if (ch === '"') top.q = 'double';
    else if (ch === '(') top.depth++;
    else if (ch === ')') {
      if (top.sub && top.depth === 0) stack.pop();
      else if (top.depth > 0) top.depth--;
    }
  }
  return { ctx: stack[stack.length - 1].q, unmodelled };
}

/**
 * The shell quoting state at `pos` in `template`: `'` and `"` toggle, a backslash escapes outside single quotes, and
 * `$(…)` opens a fresh (bare) context that its `)` closes. Not modelled: `$'…'` (ANSI-C) quoting, backticks,
 * and `$((…))` arithmetic; see `hasUnmodelledQuoting`.
 */
export function quoteContextAt(template: string, pos: number): QuoteContext {
  return scan(template, pos).ctx;
}

/** True when the template uses a shape `quoteContextAt` does not model (`$'…'` outside single quotes, backticks). */
export function hasUnmodelledQuoting(template: string): boolean {
  return scan(template, template.length).unmodelled;
}

const SAFE_BARE = /^[A-Za-z0-9@%+=:,./_-]+$/;
/** POSIX single-quoting: wraps `v` in '…', and an embedded ' becomes '\'' . */
export const singleQuoted = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;

/** Escape `value` for a Bourne shell at the given quoting context so it stays one literal word. */
export function shellEscape(value: string, ctx: QuoteContext): string {
  if (ctx === 'single') return value.replace(/'/g, `'\\''`);
  // `!` is history expansion in interactive bash and zsh, even inside double quotes: leave the quotes for it.
  if (ctx === 'double') return value.replace(/["$`\\]/g, '\\$&').replace(/!/g, `"'!'"`);
  // A leading `=` is zsh `=cmd` expansion even though `=` is otherwise safe.
  return SAFE_BARE.test(value) && !value.startsWith('=') ? value : singleQuoted(value);
}
