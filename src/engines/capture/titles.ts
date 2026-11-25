import type { BoardColumn } from '../../types/host';
import type { CommandBlock, FlagKind } from '../../types/log';
import { matchLine } from '../library/matcher';
import type { LibraryCommand } from '../library/types';

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * What the command is (the title of the `library` command its first line matches), never where: the host is its own
 * field, so the title never repeats it.
 */
export function commandTitle(blocks: CommandBlock[], library: LibraryCommand[]): string {
  const command = blocks[0]?.command ?? '';
  const line = command.split('\n').find((l) => l.trim()) ?? '';
  const match = matchLine(line, library)[0];
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

/**
 * `<ip>_<stage>_<topic>.<ext>`. A proof shot (the caption names local.txt or proof.txt, or `flag` says the shot came
 * right after that flag) is `<ip>_local-txt.<ext>` / `<ip>_proof-txt.<ext>`: what it proves, not the board column the
 * host has since moved to. A name already in `taken` gets `_2`, `_3`, … so no two shots share one.
 */
export function screenshotFileName(input: {
  ip: string | null;
  hostName: string | null;
  column: BoardColumn | null;
  caption: string;
  mime: string;
  flag?: FlagKind | null;
  taken?: ReadonlySet<string>;
}): string {
  const who = input.ip ?? input.hostName ?? 'engagement';
  const ext = EXT[input.mime.toLowerCase()] ?? 'png';
  const named = input.caption.match(/\b(local|proof)\.txt\b/i)?.[1]?.toLowerCase() as FlagKind | undefined;
  const flag = named ?? input.flag ?? null;
  let base: string;
  if (flag) base = `${who}_${flag}-txt`;
  else {
    const stage = input.column ? STAGE[input.column] : 'info';
    const port = input.caption.match(/:(\d+)/) ?? input.caption.match(/port\s*(\d+)/i);
    const words = (input.caption.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 3);
    const topic = port ? `port${port[1]}` : words.length ? words.join('-') : 'shot';
    base = `${who}_${stage}_${topic}`;
  }
  let name = `${base}.${ext}`;
  for (let n = 2; input.taken?.has(name); n++) name = `${base}_${n}.${ext}`;
  return name;
}

/** How soon after a flag a screenshot is taken to be its proof; the report pairs them over the same window. */
export const PROOF_SHOT_WINDOW_MS = 5 * 60_000;

/**
 * The flag a screenshot about to be taken of `hostId` proves: the host's latest entry other than a screenshot is a
 * flag logged at most PROOF_SHOT_WINDOW_MS ago.
 */
export function proofShotFlag(
  log: readonly { kind: string; hostIds: string[]; at: number; content: { kind: string; flagKind?: FlagKind } }[],
  hostId: string | null,
  now: number,
): FlagKind | null {
  if (!hostId) return null;
  let last: (typeof log)[number] | null = null;
  for (const e of log) {
    if (e.kind === 'screenshot' || !e.hostIds.includes(hostId) || e.at > now) continue;
    if (!last || e.at > last.at) last = e;
  }
  if (!last || last.content.kind !== 'flag' || now - last.at > PROOF_SHOT_WINDOW_MS) return null;
  return last.content.flagKind ?? null;
}
