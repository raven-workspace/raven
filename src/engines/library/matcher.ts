import type { CommandMatcher, LibraryCommand } from './types';

const regexCache = new Map<string, RegExp | null>();

function compile(source: string): RegExp | null {
  if (regexCache.has(source)) return regexCache.get(source) ?? null;
  let re: RegExp | null;
  try {
    re = new RegExp(source, 'i');
  } catch {
    re = null;
  }
  regexCache.set(source, re);
  return re;
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Returns the index after the wrapper's own flags, or the same index if no wrapper. */
function skipWrapper(tokens: string[], i: number): number {
  const t = tokens[i].toLowerCase();
  if (t === 'sudo') {
    let j = i + 1;
    while (j < tokens.length && tokens[j].startsWith('-')) {
      // -u/-g take a value
      j += tokens[j] === '-u' || tokens[j] === '-g' ? 2 : 1;
    }
    return j;
  }
  if (t === 'proxychains' || t === 'proxychains4') {
    let j = i + 1;
    while (j < tokens.length && tokens[j].startsWith('-')) {
      j += tokens[j] === '-f' ? 2 : 1;
    }
    return j;
  }
  if (t === 'env') {
    let j = i + 1;
    while (j < tokens.length && (tokens[j].startsWith('-') || ENV_ASSIGN.test(tokens[j]))) j += 1;
    return j;
  }
  if (t === 'time' || t === 'nohup') return i + 1;
  if (ENV_ASSIGN.test(tokens[i])) return i + 1;
  return i;
}

/** A binary's name: basename on `/` or `\`, lower-case, without a trailing `.exe` (`C:\Tools\winPEASx64.exe` -> `winpeasx64`). */
function binName(token: string): string {
  return (token.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '');
}

/** Basename, lower-case and without `.exe`, of the first real binary in a command line. */
export function firstBinary(line: string): string | null {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const next = skipWrapper(tokens, i);
    if (next === i) break;
    i = next;
  }
  if (tokens.length === 0) return null;
  // A wrapper with nothing after its own flags is the command itself (`sudo -l`, bare `env`).
  if (i >= tokens.length) i = 0;
  const base = binName(tokens[i]);
  return base || null;
}

/** Cut at the first unquoted command separator (; && || |) or comment (#). */
export function firstSegment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ';' || ch === '|' || (ch === '&' && line[i + 1] === '&')) return line.slice(0, i);
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

export function matchesCommand(fullLine: string, m: CommandMatcher): boolean {
  const line = firstSegment(fullLine);
  const bin = firstBinary(line);
  if (!bin || !m.bins.some((b) => binName(b) === bin)) return false;
  if (m.all) {
    for (const src of m.all) {
      const re = compile(src);
      if (!re || !re.test(line)) return false;
    }
  }
  if (m.any && m.any.length > 0) {
    if (!m.any.some((src) => compile(src)?.test(line))) return false;
  }
  if (m.none) {
    for (const src of m.none) {
      const re = compile(src);
      if (!re || re.test(line)) return false;
    }
  }
  return true;
}

export function matchLine(line: string, library: LibraryCommand[]): LibraryCommand[] {
  return library.filter((c) => c.match && matchesCommand(line, c.match));
}
