import type { CardMeta } from '../library/store';
import { splitFrontmatter } from './frontmatter';

export interface ParsedBlock {
  title: string;
  why?: string;
  template: string;
  runFrom: 'attacker' | 'target';
  /** The `**Sub-method: X**` label in force when the block appears. */
  group?: string;
  note?: string;
  /** Position among the card's parsed blocks. */
  index: number;
}

export interface ParsedCard {
  meta: CardMeta;
  blocks: ParsedBlock[];
}

const OSES = ['linux', 'windows', 'any'] as const;

/** Parses a Field-Manual trigger card (Conventions.md §5). Null unless `type: card`. */
export function parseCard(relPath: string, text: string): ParsedCard | null {
  const { fm, body } = splitFrontmatter(text);
  if (fm.type !== 'card') return null;
  const os = OSES.find((o) => o === fm.os) ?? 'any';
  const meta: CardMeta = {
    id: fm.id ?? '',
    title: fm.title ?? '',
    stage: fm.stage ?? '',
    category: fm.category ?? '',
    os,
    file: relPath,
  };

  const blocks: ParsedBlock[] = [];
  let group: string | undefined;
  let title: string | undefined;
  let why: string | undefined;
  let last: ParsedBlock | undefined;
  let notes: string[] = [];
  const flushNotes = () => {
    if (last && notes.length) last.note = notes.join('\n');
    notes = [];
  };

  let fence: { title?: string; lines: string[] } | null = null;
  for (const line of body.split('\n')) {
    if (fence) {
      if (/^\s*```\s*$/.test(line)) {
        const t = fence.title;
        if (t && title) {
          const runFrom: 'attacker' | 'target' = /^kali\b/i.test(t) ? 'attacker' : 'target';
          last = { title, why, template: fence.lines.join('\n').trim(), runFrom, group, index: blocks.length };
          blocks.push(last);
        } else {
          last = undefined;
        }
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const open = /^\s*```\S*(.*)$/.exec(line);
    if (open) {
      flushNotes();
      fence = { title: /title:\s*"([^"]*)"/.exec(open[1])?.[1].trim() || undefined, lines: [] };
      continue;
    }
    if (/^##\s/.test(line)) {
      flushNotes();
      last = undefined;
      title = why = group = undefined;
      continue;
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3) {
      flushNotes();
      last = undefined;
      title = h3[1];
      why = undefined;
      continue;
    }
    const sub = /^\*\*Sub-method:\s*(.+?)\*\*\s*$/.exec(line);
    if (sub) {
      flushNotes();
      last = undefined;
      group = sub[1].trim();
      continue;
    }
    const w = /^\*\*Why:\*\*\s*(.*?)\s*$/.exec(line);
    if (w && title) {
      why = w[1] || undefined;
      continue;
    }
    const n = /^\*\*Note:\*\*\s*(.*?)\s*$/.exec(line);
    if (n && last) notes.push(n[1]);
  }
  flushNotes();
  return { meta, blocks };
}
