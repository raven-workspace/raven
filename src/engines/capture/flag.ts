import type { FlagKind } from '../../types/log';

/** A file read naming local.txt or proof.txt, with or without a prompt in front. */
const READS_FLAG = /\b(?:cat|type|more|less|head|tail|get-content|gc)\b.*?\b(local|proof)\.txt\b/i;
const VALUE = /^([0-9a-f]{32})(?![0-9a-f])/i;

export type FoundFlag = { value: string; flagKind: FlagKind };

/**
 * A flag read inside a terminal block: a line reading `local.txt` / `proof.txt` followed by a 32-hex
 * line. The last such read wins (a block that shows both reads proof last).
 */
export function findFlagInPaste(text: string): FoundFlag | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let found: FoundFlag | null = null;
  for (let i = 0; i < lines.length - 1; i++) {
    const read = lines[i].match(READS_FLAG);
    const value = read && lines[i + 1].match(VALUE);
    if (read && value) found = { value: value[1], flagKind: read[1].toLowerCase() as FlagKind };
  }
  return found;
}
