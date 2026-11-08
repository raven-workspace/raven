import type { BoardColumn } from '../../types/host';
import type { CommandBlock, FlagKind } from '../../types/log';
import { matchLine } from '../library/matcher';
import { getLibrary } from '../library/store';

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** What the command is, never where: the host is its own field, so the title never repeats it. */
export function commandTitle(blocks: CommandBlock[]): string {
  const command = blocks[0]?.command ?? '';
  const line = command.split('\n').find((l) => l.trim()) ?? '';
  const match = matchLine(line, getLibrary())[0];
  if (!match) return collapse(line).slice(0, 200);
  return match.title;
}

export function noteTitle(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return first.replace(/^[#\s]+/, '').trim().slice(0, 120);
}

export function flagTitle(flagKind: FlagKind): string {
  return `${flagKind}.txt`;
}

const STAGE: Record<BoardColumn, string> = {
  'information-gathering': 'info',
  'vulnerability-detection': 'vulns',
  'initial-foothold': 'foothold',
  'privilege-escalation': 'privesc',
  'post-exploitation': 'post-ex',
  reporting: 'report',
};
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export function screenshotFileName(input: {
  ip: string | null;
  hostName: string | null;
  column: BoardColumn | null;
  caption: string;
  mime: string;
}): string {
  const stage = input.column ? STAGE[input.column] : 'info';
  const port = input.caption.match(/:(\d+)/) ?? input.caption.match(/port\s*(\d+)/i);
  const words = (input.caption.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 3);
  const topic = port ? `port${port[1]}` : words.length ? words.join('-') : 'shot';
  const ext = EXT[input.mime.toLowerCase()] ?? 'png';
  return `${input.ip ?? input.hostName ?? 'engagement'}_${stage}_${topic}.${ext}`;
}
