import type { CardMeta } from '../library/store';
import type { LibraryCommand } from '../library/types';

export interface TransferMethod {
  id: string;
  /** The tab: the fetch tool for an HTTP method, else the group's name. */
  label: string;
  /** The card's `**Sub-method: X**` group. */
  group: string;
  /** "On Kali": the group's Kali blocks, in card order. */
  kali: LibraryCommand[];
  /** "On <host>": the Target blocks. Empty for a Kali-only group. */
  target: LibraryCommand[];
}

/** The card each target OS reads (spec §4). */
export const TRANSFER_CARD: Record<'windows' | 'linux', string> = {
  windows: 'shell-file-transfer-to-windows',
  linux: 'shell-file-transfer-to-linux',
};

const GROUP_TAG = 'group:';
const groupOf = (c: LibraryCommand): string => c.tags?.find((t) => t.startsWith(GROUP_TAG))?.slice(GROUP_TAG.length).trim() || 'Other';
const isHttp = (group: string): boolean => /^http\b/i.test(group);

/** A Target block that works on the fetched file rather than fetching it. */
const FOLLOW_UP = /^\s*(?:chmod|md5sum|sha1sum|sha256sum)\b/;

/** "Download with certutil" → "certutil". */
const labelOf = (title: string): string => title.replace(/^(?:Download|Pull|Fetch)\s+(?:with|using|via)\s+/i, '').trim() || title;

/**
 * The generator's methods for one target OS, read from the transfer card's commands (spec §4):
 * an HTTP group gives one method per Target block, each sharing the group's Kali (serve) blocks; any other group is
 * one method with all its blocks; a group with no Target block is Kali-only. Block order is `library`'s order.
 * `cards` is only used to confirm the card exists; with an imported card the library already holds its blocks.
 */
export function transferMethods(cards: CardMeta[], library: LibraryCommand[], os: 'windows' | 'linux'): TransferMethod[] {
  const cardId = TRANSFER_CARD[os];
  if (!cards.some((c) => c.id === cardId)) return [];
  const groups = new Map<string, LibraryCommand[]>();
  for (const c of library) {
    if (c.cardId !== cardId) continue;
    const g = groupOf(c);
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const out: TransferMethod[] = [];
  for (const [group, blocks] of groups) {
    const kali = blocks.filter((c) => c.runFrom === 'attacker');
    const target = blocks.filter((c) => c.runFrom === 'target');
    const fetches = target.filter((t) => !FOLLOW_UP.test(t.template));
    if (isHttp(group) && fetches.length > 0) {
      // Target blocks that fetch nothing (chmod, a checksum) are the "then" step of every fetch method.
      const then = target.filter((t) => FOLLOW_UP.test(t.template));
      for (const t of fetches) out.push({ id: `${cardId}:${group}:${t.id}`, label: labelOf(t.title), group, kali, target: [t, ...then] });
    } else {
      out.push({ id: `${cardId}:${group}`, label: group, group, kali, target });
    }
  }
  return out;
}
