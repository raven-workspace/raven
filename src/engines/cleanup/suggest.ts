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

/**
 * Option value for a short flag letter (also inside a cluster: `-qO x`, `-sSLo x`, attached `-qOx`) or a long option
 * (`--output x`, `--output=x`).
 */
function optValue(t: string[], short: string | null, long: string | null): string | null {
  const cluster = short ? new RegExp(`^-[A-Za-z]*?${short}(.*)$`) : null;
  for (let i = 1; i < t.length; i++) {
    const a = t[i];
    if (long && a === long) return t[i + 1] ?? null;
    if (long && a.startsWith(`${long}=`)) return a.slice(long.length + 1);
    if (cluster && !a.startsWith('--')) {
      const m = cluster.exec(a);
      if (m) return m[1] === '' ? (t[i + 1] ?? null) : m[1];
    }
  }
  return null;
}

/** Path after an unquoted-looking `>` / `>>` redirect of stdout (not `2>` or `2>&1`). */
function redirectTarget(t: string[]): string | null {
  for (let i = 1; i < t.length; i++) {
    const m = /^>>?(.*)$/.exec(t[i]);
    if (!m) continue;
    const path = m[1] === '' ? t[i + 1] : m[1];
    return path && !path.startsWith('&') && path !== '/dev/null' ? path : null;
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

/** A destination that names a directory takes the source's basename. */
function destTarget(dest: string | undefined, src: string): string {
  const base = baseName(src);
  if (dest === undefined || dest === '.') return base;
  if (dest === '~') return `~/${base}`;
  return /[\\/]$/.test(dest) ? `${dest}${base}` : dest;
}

function putArgs(args: string[]): Match | null {
  if (args.length === 0) return null;
  return { kind: 'file', target: destTarget(args[1], args[0]), push: true };
}

const SCP_VALUE_FLAGS = new Set(['-P', '-i', '-o', '-F', '-l', '-c', '-J', '-S', '-D']);
function scpSource(t: string[]): string | null {
  for (let i = 1; i < t.length - 1; i++) {
    if (SCP_VALUE_FLAGS.has(t[i])) i++;
    else if (!t[i].startsWith('-')) return t[i];
  }
  return null;
}

function remoteScpPath(dest: string): string | null {
  const m = /^(?:[^@\s:/\\]+@)?([^@\s:/\\]+):(.*)$/.exec(dest);
  if (!m || m[1].length < 2 || !m[2]) return null; // single letter = drive, empty path = nothing named
  return m[2];
}

const PS_WRAP = /^(?:powershell|pwsh)(?:\.exe)?\s.*?\s-(?:c|command)\s+(.+)$/is;
const CMD_WRAP = /^cmd(?:\.exe)?\s+\/[ck]\s+(.+)$/is;
const DOWNLOAD_FILE = /\.DownloadFile\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3\s*\)/is;

function unquote(text: string): string {
  const x = text.trim();
  const q = x[0];
  return (q === '"' || q === "'") && x.length > 1 && x.endsWith(q) ? x.slice(1, -1) : x;
}

function matchSegment(segment: string, inSmbclient: boolean, depth = 0): Match[] {
  const wrap = depth === 0 ? (PS_WRAP.exec(segment) ?? CMD_WRAP.exec(segment)) : null;
  if (wrap) return splitSegments(unquote(wrap[1])).flatMap((inner) => matchSegment(inner, inSmbclient, 1));
  const dl = DOWNLOAD_FILE.exec(segment);
  if (dl && dl[4]) return [{ kind: 'file', target: dl[4], push: false }];
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
      file(ps ?? optValue(t, 'O', '--output-document') ?? redirectTarget(t));
      break;
    }
    case 'iwr':
    case 'invoke-webrequest':
      file(outFile(t));
      break;
    case 'curl':
      file(outFile(t) ?? optValue(t, 'o', '--output') ?? redirectTarget(t));
      break;
    case 'certutil':
      if (t.some((a) => /^[-/]urlcache$/i.test(a)) && t.length > 2) file(t[t.length - 1]);
      break;
    case 'net':
    case 'net1':
      if (eq(t[1] ?? '', 'user') && t.some((a) => eq(a, '/add'))) {
        const name = t.slice(2).find((a) => !a.startsWith('/'));
        if (name) res.push({ kind: 'account', target: name, push: false });
      }
      break;
    case 'useradd':
    case 'adduser': {
      const pos = positionals(t.slice(1));
      const name = cmd === 'adduser' && pos.length === 2 ? pos[0] : pos.pop();
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
      const src = scpSource(t);
      if (p && src) res.push({ kind: 'file', target: destTarget(p, src), push: true });
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
    (entry.content.blocks ?? []).forEach((block, blockIndex) => {
      const lines = String(block?.command ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      const inSmbclient = lines[0] !== undefined && /^smbclient(\s|$)/i.test(lines[0]);
      const local = shellHost(block?.shell, entry.ranOn ?? undefined, hosts, domain);
      let lastNamed: string | null = null;
      for (const line of lines) {
        for (const segment of splitSegments(line)) {
          for (const m of matchSegment(segment, inSmbclient)) {
            let hostId: string | null;
            if (m.push) hostId = namedHostsInLine(segment, hosts, domain)[0]?.id ?? lastNamed ?? entry.hostIds?.[0] ?? null;
            else if (local) hostId = local.id;
            else continue;
            const key = `${entry.id}:${blockIndex}:${m.target}`;
            if (skip.has(key) || seen.has(key)) continue;
            seen.add(key);
            out.push({ key, entryId: entry.id, hostId, kind: m.kind, target: m.target, command: line });
          }
        }
        lastNamed = namedHostsInLine(line, hosts, domain)[0]?.id ?? lastNamed;
      }
    });
  }
  return out;
}
