import type { LogKind } from '../../types/log';
import { firstBinary, firstSegment } from '../library/matcher';
import { getLibrary, libraryVersion } from '../library/store';
import { detectPrompt } from '../parse/logPaste';
import { findFlagInPaste } from './flag';

const HTTP_REQUEST = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \S+ HTTP\/\d/;
const FLAG = /^[0-9a-f]{32}$/i;
const COMMON_BINS = new Set(
  (
    'ping curl wget nc ncat ssh scp cat ls cd python python3 ruby perl php bash sh sudo echo grep find chmod ' +
    'whoami hostname id ip ifconfig ipconfig uname systeminfo netstat ss ps env head tail powershell'
  ).split(' '),
);
let libraryBins: { version: number; bins: Set<string> } | null = null;
/** The library's matcher binaries, computed lazily and again whenever the library version changes. */
function libraryBinSet(): Set<string> {
  const version = libraryVersion();
  if (libraryBins?.version !== version) {
    libraryBins = {
      version,
      bins: new Set(getLibrary().flatMap((c) => c.match?.bins ?? []).map((b) => b.toLowerCase().replace(/\.exe$/, ''))),
    };
  }
  return libraryBins.bins;
}

/** What a paste is: image, HTTP request, 32-hex flag (bare or read from local/proof.txt), shell command(s), else a note. */
export function detectKind(text: string, hasImage: boolean): LogKind {
  if (hasImage) return 'screenshot';
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.find((l) => l.trim()) ?? '';
  if (HTTP_REQUEST.test(first.trim())) return 'http';
  if (FLAG.test(text.trim()) || findFlagInPaste(text)) return 'flag';
  if (lines.some((l) => detectPrompt(l) !== null)) return 'command';
  const bin = firstBinary(firstSegment(first));
  if (bin && (libraryBinSet().has(bin) || COMMON_BINS.has(bin))) return 'command';
  if (first.trim().startsWith('./')) return 'command';
  return 'note';
}
