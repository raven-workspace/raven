import { namedHostsInLine, shellHost, type HostRef } from '../attribution';
import type { CleanupItem } from '../../types/cleanup';
import type { LogEntry } from '../../types/log';

export interface CleanupSuggestion {
  key: string;
  entryId: string;
  hostId: string | null;
  kind: 'file' | 'account' | 'service';
  target: string;
  command: string;
}

/** Split a line at unquoted `&&`, `;` and `|` (so `||` too). */
function splitSegments(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ';' || c === '|' || (c === '&' && line[i + 1] === '&')) {
      if (c === '&' || (c === '|' && line[i + 1] === '|')) i++;
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Whitespace-split, quote-aware; quotes are dropped, quoted spaces kept. No backslash escapes (Windows paths). */
function tokenize(segment: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let quote: string | null = null;
  for (const c of segment) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

type Match = { kind: CleanupSuggestion['kind']; target: string; push: boolean };

/** `-O x`, `-Ox`, `--output-document=x` / `--output-document x` style option value. */
function optValue(t: string[], short: string | null, long: string | null): string | null {
  for (let i = 1; i < t.length; i++) {
    const a = t[i];
    if (long && a === long) return t[i + 1] ?? null;
    if (long && a.startsWith(`${long}=`)) return a.slice(long.length + 1);
    if (short && a === short) return t[i + 1] ?? null;
    if (short && a.startsWith(short) && !a.startsWith('--') && a.length > short.length) return a.slice(short.length);
  }
  return null;
}

function outFile(t: string[]): string | null {
  for (let i = 1; i < t.length; i++) if (eq(t[i], '-OutFile')) return t[i + 1] ?? null;
  return null;
}

const VALUE_FLAGS = new Set(['-s', '-d', '-g', '-G', '-c', '-e', '-f', '-k', '-K', '-p', '-u', '-b', '-Z']);
const VALUE_LONG = new Set([
  '--shell', '--home', '--home-dir', '--gid', '--ingroup', '--groups', '--comment', '--gecos', '--expiredate', '--inactive',
  '--skel', '--key', '--password', '--uid', '--base-dir', '--selinux-user', '--firstuid', '--lastuid', '--add_extra_groups',
]);

/** Arguments that are neither flags nor the value of a flag that takes one. */
function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.has(a) || VALUE_LONG.has(a)) i++;
    else if (!a.startsWith('-')) out.push(a);
  }
  return out;
}

function putArgs(args: string[]): Match | null {
  if (args.length === 0) return null;
  return { kind: 'file', target: args[1] ?? baseName(args[0]), push: true };
}

function remoteScpPath(dest: string): string | null {
  const m = /^(?:[^@\s:/\\]+@)?([^@\s:/\\]+):(.*)$/.exec(dest);
  if (!m || m[1].length < 2 || !m[2]) return null; // single letter = drive, empty path = nothing named
  return m[2];
}

function matchSegment(segment: string, inSmbclient: boolean): Match[] {
  const t = tokenize(segment);
  if (t.length === 0) return [];
  if (eq(t[0], 'sudo')) t.shift();
  if (t.length === 0) return [];
  const cmd = t[0].toLowerCase().replace(/\.exe$/, '');
  const res: Match[] = [];
  const file = (target: string | null) => {
    if (target && target !== '-') res.push({ kind: 'file', target, push: false });
  };

  switch (cmd) {
    case 'wget': {
      const ps = outFile(t);
      file(ps ?? optValue(t, '-O', '--output-document'));
      break;
    }
    case 'iwr':
    case 'invoke-webrequest':
      file(outFile(t));
      break;
    case 'curl':
      file(optValue(t, '-o', '--output'));
      break;
    case 'certutil':
      if (t.some((a) => /^[-/]urlcache$/i.test(a)) && t.length > 2) file(t[t.length - 1]);
      break;
    case 'net':
    case 'net1':
      if (eq(t[1] ?? '', 'user') && t[2] && t.some((a) => eq(a, '/add'))) res.push({ kind: 'account', target: t[2], push: false });
      break;
    case 'useradd':
    case 'adduser': {
      const name = positionals(t.slice(1)).pop();
      if (name) res.push({ kind: 'account', target: name, push: false });
      break;
    }
    case 'sc':
      if ((eq(t[1] ?? '', 'create') || eq(t[1] ?? '', 'config')) && t[2]) res.push({ kind: 'service', target: t[2], push: false });
      break;
    case 'new-service': {
      const i = t.findIndex((a) => eq(a, '-Name'));
      if (i > 0 && t[i + 1]) res.push({ kind: 'service', target: t[i + 1], push: false });
      break;
    }
    case 'scp': {
      const p = remoteScpPath(t[t.length - 1]);
      if (t.length >= 3 && p) res.push({ kind: 'file', target: p, push: true });
      break;
    }
    case 'smbclient':
      for (let i = 1; i < t.length; i++) {
        if (t[i] !== '-c' || !t[i + 1]) continue;
        for (const cmdLine of splitSegments(t[i + 1])) {
          const ct = tokenize(cmdLine);
          if (eq(ct[0] ?? '', 'put')) {
            const m = putArgs(ct.slice(1));
            if (m) res.push(m);
          }
        }
      }
      break;
    case 'put':
      if (inSmbclient) {
        const m = putArgs(t.slice(1));
        if (m) res.push(m);
      }
      break;
    case 'upload': {
      const m = putArgs(t.slice(1));
      if (m) res.push(m);
      break;
    }
  }
  return res;
}

export function suggestCleanup(entries: LogEntry[], hosts: HostRef[], domain: string, known: CleanupItem[]): CleanupSuggestion[] {
  const skip = new Set(known.map((k) => k.suggestionKey).filter((k): k is string => !!k));
  const seen = new Set<string>();
  const out: CleanupSuggestion[] = [];
  const sorted = entries.filter((e) => e.kind === 'command').sort((a, b) => b.at - a.at);

  for (const entry of sorted) {
    if (entry.content.kind !== 'command') continue;
    entry.content.blocks.forEach((block, blockIndex) => {
      const lines = block.command.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      const inSmbclient = lines[0] !== undefined && /^smbclient(\s|$)/i.test(lines[0]);
      const local = shellHost(block.shell, entry.ranOn ?? undefined, hosts, domain);
      for (const line of lines) {
        for (const segment of splitSegments(line)) {
          for (const m of matchSegment(segment, inSmbclient)) {
            let hostId: string | null;
            if (m.push) hostId = namedHostsInLine(segment, hosts, domain)[0]?.id ?? entry.hostIds[0] ?? null;
            else if (local) hostId = local.id;
            else continue;
            const key = `${entry.id}:${blockIndex}:${m.target}`;
            if (skip.has(key) || seen.has(key)) continue;
            seen.add(key);
            out.push({ key, entryId: entry.id, hostId, kind: m.kind, target: m.target, command: line });
          }
        }
      }
    });
  }
  return out;
}
