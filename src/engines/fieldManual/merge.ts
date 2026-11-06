import { FIELD_MANUAL_CARDS } from '../library/data/fieldManual';
import type { CardMeta } from '../library/store';
import type { ExamRule, LibraryCommand } from '../library/types';
import { classifyExam } from './classifyExam';
import type { ParsedBlock, ParsedCard } from './parseCard';
import type { PlaybookItem } from './parsePlaybook';
import type { ToolkitEntry } from './parseToolkit';

export interface ImportReport {
  cardsAdded: number;
  cardsChanged: number;
  cardsRemoved: number;
  commandsAdded: number;
  commandsChanged: number;
  /** Ids of commands whose block is gone from the vault; they stay in the library. */
  commandsRemovedKept: string[];
  /** Commands that gained an exam rule from classification. */
  classified: { id: string; exam: ExamRule }[];
}

/** What an import stores, and what `mergeImport` reads back as `previous`. */
export interface FieldManualSnapshot {
  importedAt: number;
  cards: CardMeta[];
  /** The full merged command list (built-ins included). */
  commands: LibraryCommand[];
  playbook: PlaybookItem[];
  toolkit: ToolkitEntry[];
  report: ImportReport;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const STRENGTH: Record<ExamRule, number> = { metasploit: 1, banned: 2 };
const stronger = (a?: ExamRule, b?: ExamRule): ExamRule | undefined =>
  !a ? b : !b ? a : STRENGTH[b] > STRENGTH[a] ? b : a;

const toolOf = (template: string): string => {
  const line = template.split('\n').find((l) => l.trim() && !l.trim().startsWith('#')) ?? '';
  return line.trim().split(/\s+/)[0] ?? '';
};

const cardChanged = (a: CardMeta, b: CardMeta): boolean =>
  a.title !== b.title || a.stage !== b.stage || a.category !== b.category || a.os !== b.os || a.file !== b.file;

/**
 * Merges parsed vault cards over the built-in library (spec §5). Nothing is ever dropped: a built-in whose block is
 * gone from the vault stays and is reported. A matched command keeps its id, matcher, goals, tool and exam rule;
 * only title, why and template follow the vault. `previous` is the last import, so re-importing is idempotent.
 */
export function mergeImport(
  builtins: LibraryCommand[],
  parsed: ParsedCard[],
  previous?: FieldManualSnapshot,
): { commands: LibraryCommand[]; report: ImportReport } {
  const builtinIds = new Set(builtins.map((b) => b.id));
  const prevById = new Map((previous?.commands ?? []).map((c) => [c.id, c]));
  const base: LibraryCommand[] = [
    ...builtins.map((b) => prevById.get(b.id) ?? b),
    ...(previous?.commands ?? []).filter((c) => !builtinIds.has(c.id)),
  ];
  const usedIds = new Set(base.map((c) => c.id));
  const replaced = new Map<string, LibraryCommand>();
  const added: LibraryCommand[] = [];
  const removedKept: string[] = [];
  const classified: ImportReport['classified'] = [];
  let commandsChanged = 0;

  for (const card of parsed) {
    const cardId = card.meta.id;
    const pool = base.filter((c) => c.source === 'field-manual' && c.cardId === cardId);
    const taken = new Set<string>();
    const matchOf = new Map<ParsedBlock, LibraryCommand>();
    const byTitle = (b: ParsedBlock) => pool.find((c) => !taken.has(c.id) && c.title === b.title);
    const byTemplate = (b: ParsedBlock) =>
      pool.find((c) => !taken.has(c.id) && norm(c.template) === norm(b.template));
    for (const finder of [byTitle, byTemplate]) {
      for (const b of card.blocks) {
        if (matchOf.has(b)) continue;
        const hit = finder(b);
        if (hit) {
          matchOf.set(b, hit);
          taken.add(hit.id);
        }
      }
    }

    const cardGoals = [...new Set(pool.flatMap((c) => c.goals))];
    for (const b of card.blocks) {
      const hit = matchOf.get(b);
      if (hit) {
        const next: LibraryCommand = { ...hit, title: b.title, template: b.template };
        if (b.why !== undefined) next.why = b.why;
        const exam = stronger(hit.exam, classifyExam(b.template, undefined, b.note));
        if (exam) next.exam = exam;
        if (exam && exam !== hit.exam) classified.push({ id: hit.id, exam });
        if (next.title !== hit.title || next.template !== hit.template || next.why !== hit.why) {
          commandsChanged++;
          replaced.set(hit.id, next);
        } else if (next.exam !== hit.exam) {
          replaced.set(hit.id, next);
        }
      } else {
        let id = `fm-${cardId}-v${b.index}`;
        for (let n = 2; usedIds.has(id); n++) id = `fm-${cardId}-v${b.index}-${n}`;
        usedIds.add(id);
        const exam = classifyExam(b.template, undefined, b.note);
        const cmd: LibraryCommand = {
          id,
          title: b.title,
          tool: toolOf(b.template),
          template: b.template,
          os: card.meta.os,
          runFrom: b.runFrom,
          goals: [...cardGoals],
          source: 'field-manual',
          cardId,
        };
        if (b.why !== undefined) cmd.why = b.why;
        if (exam) {
          cmd.exam = exam;
          classified.push({ id, exam });
        }
        added.push(cmd);
      }
    }
    for (const c of pool) if (!taken.has(c.id)) removedKept.push(c.id);
  }

  const knownCards = new Map<string, CardMeta>(FIELD_MANUAL_CARDS.map((c) => [c.id, c]));
  for (const c of previous?.cards ?? []) knownCards.set(c.id, c);
  const parsedIds = new Set(parsed.map((p) => p.meta.id));
  const report: ImportReport = {
    cardsAdded: parsed.filter((p) => !knownCards.has(p.meta.id)).length,
    cardsChanged: parsed.filter((p) => {
      const k = knownCards.get(p.meta.id);
      return k !== undefined && cardChanged(k, p.meta);
    }).length,
    cardsRemoved: [...knownCards.keys()].filter((id) => !parsedIds.has(id)).length,
    commandsAdded: added.length,
    commandsChanged,
    commandsRemovedKept: removedKept,
    classified,
  };
  return { commands: [...base.map((c) => replaced.get(c.id) ?? c), ...added], report };
}
