import type { CardMeta } from '../library/types';
import { splitFrontmatter } from './frontmatter';

export interface ParsedBlock {
  title: string;
  why?: string;
  template: string;
  runFrom: 'attacker' | 'target';
  /** The `**Sub-method: X**` label in force when the block appears. */
  group?: string;
  note?: string;
  /** The `**Exam:**` line(s) that follow the block, for display only. */
  exam?: string;
  /** Position among the card's parsed blocks. */
  index: number;
}

export interface ParsedCard {
  meta: CardMeta;
  blocks: ParsedBlock[];
  /** The card's frontmatter `exam` (e.g. `prohibited`). */
  exam?: string;
  /** `**Exam:**` lines that appear before the first block. */
  examNotes?: string[];
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
  let exams: string[] = [];
  const examNotes: string[] = [];
  const flushNotes = () => {
    if (last && notes.length) last.note = notes.join('\n');
    if (last && exams.length) last.exam = exams.join('\n');
    notes = [];
    exams = [];
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
    const ex = /^\*\*Exam:\*\*\s*(.*?)\s*$/.exec(line);
    if (ex) {
      if (last) exams.push(ex[1]);
      else if (blocks.length === 0) examNotes.push(ex[1]);
    }
  }
  flushNotes();
  const out: ParsedCard = { meta, blocks };
  if (fm.exam) out.exam = fm.exam;
  if (examNotes.length) out.examNotes = examNotes;
  return out;
}
