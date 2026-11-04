import type { LogKind } from '../../types/log';
import { BUILTIN_LIBRARY } from '../library/data';
import { firstBinary } from '../library/matcher';
import { detectPrompt } from '../parse/logPaste';

const HTTP_REQUEST = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \S+ HTTP\/\d/;
const FLAG = /^[0-9a-f]{32}$/i;
const COMMON_BINS = new Set(
  'ping curl wget nc ncat ssh scp cat ls cd python python3 ruby perl php bash sh sudo echo grep find chmod'.split(' '),
);
const LIBRARY_BINS = new Set(
  BUILTIN_LIBRARY.flatMap((c) => c.match?.bins ?? []).map((b) => b.toLowerCase().replace(/\.exe$/, '')),
);

/** What a paste is: image, HTTP request, 32-hex flag, shell command(s), else a note. */
export function detectKind(text: string, hasImage: boolean): LogKind {
  if (hasImage) return 'screenshot';
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.find((l) => l.trim()) ?? '';
  if (HTTP_REQUEST.test(first.trim())) return 'http';
  if (FLAG.test(text.trim())) return 'flag';
  if (lines.some((l) => detectPrompt(l) !== null)) return 'command';
  const bin = firstBinary(first);
  if (bin && (LIBRARY_BINS.has(bin) || COMMON_BINS.has(bin))) return 'command';
  if (first.trim().startsWith('./')) return 'command';
  return 'note';
}
