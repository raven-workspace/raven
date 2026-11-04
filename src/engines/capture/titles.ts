import type { BoardColumn } from '../../types/host';
import type { CommandBlock, FlagKind } from '../../types/log';
import { HOST_IP, namedHostsInLine, type HostRef } from '../attribution';
import { BUILTIN_LIBRARY } from '../library/data';
import { matchLine } from '../library/matcher';

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function commandTitle(blocks: CommandBlock[], hosts: HostRef[], domain: string): string {
  const command = blocks[0]?.command ?? '';
  const line = command.split('\n').find((l) => l.trim()) ?? '';
  const match = matchLine(line, BUILTIN_LIBRARY)[0];
  if (!match) return collapse(line).slice(0, 200);
  const named = namedHostsInLine(line, hosts, domain)[0];
  const target = named ? (named.ip ?? named.name) : (line.match(HOST_IP)?.[0] ?? null);
  return target ? `${match.title} · ${target}` : match.title;
}

export function noteTitle(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return first.replace(/^[#\s]+/, '').trim().slice(0, 120);
}

export function flagTitle(flagKind: FlagKind, host: HostRef | null): string {
  return host ? `${flagKind}.txt · ${host.name}` : `${flagKind}.txt`;
}

const STAGE: Record<BoardColumn, string> = { enumerate: 'enum', foothold: 'foothold', privesc: 'privesc', loot: 'loot', done: 'done' };
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export function screenshotFileName(input: {
  ip: string | null;
  hostName: string | null;
  column: BoardColumn | null;
  caption: string;
  mime: string;
}): string {
  const stage = input.column ? STAGE[input.column] : 'enum';
  const port = input.caption.match(/:(\d+)/) ?? input.caption.match(/port\s*(\d+)/i);
  const words = (input.caption.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 3);
  const topic = port ? `port${port[1]}` : words.length ? words.join('-') : 'shot';
  const ext = EXT[input.mime.toLowerCase()] ?? 'png';
  return `${input.ip ?? input.hostName ?? 'engagement'}_${stage}_${topic}.${ext}`;
}
