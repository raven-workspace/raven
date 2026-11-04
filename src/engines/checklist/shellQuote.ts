export type QuoteContext = 'bare' | 'single' | 'double';

/** The shell quoting state at `pos` in `template`: `'` and `"` toggle, a backslash escapes outside single quotes. */
export function quoteContextAt(template: string, pos: number): QuoteContext {
  let state: QuoteContext = 'bare';
  for (let i = 0; i < pos; i++) {
    const ch = template[i];
    if (state === 'single') {
      if (ch === "'") state = 'bare';
    } else if (ch === '\\') {
      i++;
    } else if (state === 'double') {
      if (ch === '"') state = 'bare';
    } else if (ch === "'") state = 'single';
    else if (ch === '"') state = 'double';
  }
  return state;
}

const SAFE_BARE = /^[A-Za-z0-9@%+=:,./_-]+$/;
const singleQuoted = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/** Escape `value` for a Bourne shell at the given quoting context so it stays one literal word. */
export function shellEscape(value: string, ctx: QuoteContext): string {
  if (ctx === 'single') return value.replace(/'/g, `'\\''`);
  if (ctx === 'double') return value.replace(/["$`\\]/g, '\\$&');
  return SAFE_BARE.test(value) ? value : singleQuoted(value);
}
