import { FIELD_MANUAL_CARDS } from '../library/data/fieldManual';
import type { CardMeta } from '../library/store';
import type { ExamRule, LibraryCommand } from '../library/types';
import { classifyExam } from './classifyExam';
import type { Drift } from './drift';
import type { ParsedBlock, ParsedCard } from './parseCard';
import type { PlaybookItem } from './parsePlaybook';
import type { ToolkitEntry } from './parseToolkit';
import type { ManualNote } from '../manual/types';

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
  /** Vault-added commands whose block (or whole card) is no longer in the vault; they stay. */
  addedRemoved?: string[];
  /** Vault vs Raven (spec §5). Absent on reports saved before the drift report existed. */
  drift?: Drift;
  /** Things the import worked around and the owner should check (e.g. the Manual's notes kept from the last import). */
  warnings?: string[];
}

/** What the vault changes about one built-in field-manual command. Everything else comes from the code. */
export interface CommandOverlay {
  title: string;
  why?: string;
  template: string;
  /** @deprecated written by older imports; ignored. A built-in's exam rule always comes from the code. */
  exam?: ExamRule;
}

/**
 * What an import stores. Built-ins are never copied: `overlay` is the vault's change to each matched built-in and
 * `added` the commands the vault introduced. `commands` is the old shape (a full merged list), read but never written.
 */
export interface FieldManualSnapshot {
  importedAt: number;
  cards: CardMeta[];
  overlay?: Record<string, CommandOverlay>;
  added?: LibraryCommand[];
  /** @deprecated old full-list shape; see `normalizeSnapshot`. */
  commands?: LibraryCommand[];
  playbook: PlaybookItem[];
  toolkit: ToolkitEntry[];
  /** Tools, Foundations and Reporting notes. Absent on snapshots saved before the Manual existed. */
  notes?: ManualNote[];
  report: ImportReport;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

const toolOf = (template: string): string => {
  const line = template.split('\n').find((l) => l.trim() && !l.trim().startsWith('#')) ?? '';
  return line.trim().split(/\s+/)[0] ?? '';
};

/** Overlay and added commands of a snapshot in either shape. Old shape: only field-manual entries count. */
export function normalizeSnapshot(
  snap: Pick<FieldManualSnapshot, 'overlay' | 'added' | 'commands'> | undefined,
  builtins: LibraryCommand[],
): { overlay: Record<string, CommandOverlay>; added: LibraryCommand[] } {
  if (!snap) return { overlay: {}, added: [] };
  if (snap.overlay || snap.added) return { overlay: snap.overlay ?? {}, added: snap.added ?? [] };
  const byId = new Map(builtins.map((b) => [b.id, b]));
  const overlay: Record<string, CommandOverlay> = {};
  const added: LibraryCommand[] = [];
  for (const c of snap.commands ?? []) {
    if (c.source !== 'field-manual') continue;
    const b = byId.get(c.id);
    if (!b) added.push(c);
    else if (b.source === 'field-manual') {
      const o: CommandOverlay = { title: c.title, template: c.template };
      if (c.why !== undefined) o.why = c.why;
      overlay[c.id] = o;
    }
  }
  return { overlay, added };
}

/** The current built-ins with the vault's overlay and added commands applied. Only field-manual built-ins change. */
export function applyOverlay(
  builtins: LibraryCommand[],
  snap: { overlay: Record<string, CommandOverlay>; added: LibraryCommand[] },
): LibraryCommand[] {
  const ids = new Set(builtins.map((b) => b.id));
  const out = builtins.map((b) => {
    const o = snap.overlay[b.id];
    if (!o || b.source !== 'field-manual') return b;
    const next: LibraryCommand = { ...b, title: o.title, template: o.template };
    if (o.why !== undefined) next.why = o.why;
    return next;
  });
  return [...out, ...snap.added.filter((c) => !ids.has(c.id))];
}

const cardChanged = (a: CardMeta, b: CardMeta): boolean =>
  a.title !== b.title || a.stage !== b.stage || a.category !== b.category || a.os !== b.os || a.file !== b.file;

/**
 * Merges parsed vault cards over the built-in library (spec §5). Nothing is ever dropped: a built-in whose block is
 * gone from the vault stays and is reported. A matched built-in keeps its id, matcher, goals, tool and exam rule;
 * only title, why and template follow the vault. Vault-added commands are (re)classified from their template. `previous` is the last import, so re-importing is idempotent.
 */
export function mergeImport(
  builtins: LibraryCommand[],
  parsed: ParsedCard[],
  previous?: FieldManualSnapshot,
): { commands: LibraryCommand[]; overlay: Record<string, CommandOverlay>; added: LibraryCommand[]; report: ImportReport } {
  const builtinIds = new Set(builtins.map((b) => b.id));
  const prev = normalizeSnapshot(previous, builtins);
  const base = applyOverlay(builtins, prev);
  const usedIds = new Set(base.map((c) => c.id));
  const replaced = new Map<string, LibraryCommand>();
  const added: LibraryCommand[] = [];
  const addedRemoved: string[] = [];
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
        // A built-in's exam rule is authoritative; only vault-added commands are classified.
        if (!builtinIds.has(hit.id)) {
          const exam = classifyExam(b.template, card.exam, b.note);
          if (exam) next.exam = exam;
          else delete next.exam;
          if (exam && exam !== hit.exam) classified.push({ id: hit.id, exam });
        }
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
        const exam = classifyExam(b.template, card.exam, b.note);
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
        // The Sub-method group drives the Transfer a file generator's methods.
        if (b.group) cmd.tags = [`group:${b.group}`];
        if (exam) {
          cmd.exam = exam;
          classified.push({ id, exam });
        }
        added.push(cmd);
      }
    }
    for (const c of pool) if (!taken.has(c.id)) (builtinIds.has(c.id) ? removedKept : addedRemoved).push(c.id);
  }

  const knownCards = new Map<string, CardMeta>(FIELD_MANUAL_CARDS.map((c) => [c.id, c]));
  for (const c of previous?.cards ?? []) knownCards.set(c.id, c);
  const parsedIds = new Set(parsed.map((p) => p.meta.id));
  // Cards missing from the vault entirely (e.g. iCloud-evicted placeholders): keep their commands, and say so.
  for (const c of base) {
    if (c.source !== 'field-manual' || !c.cardId || parsedIds.has(c.cardId)) continue;
    (builtinIds.has(c.id) ? removedKept : addedRemoved).push(c.id);
  }
  const final = base.map((c) => replaced.get(c.id) ?? c);
  const overlay: Record<string, CommandOverlay> = {};
  for (const b of builtins) {
    const f = final.find((c) => c.id === b.id);
    if (!f || b.source !== 'field-manual') continue;
    if (f.title === b.title && f.template === b.template && f.why === b.why) continue;
    const o: CommandOverlay = { title: f.title, template: f.template };
    if (f.why !== undefined) o.why = f.why;
    overlay[b.id] = o;
  }
  const allAdded = [...final.filter((c) => !builtinIds.has(c.id)), ...added];
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
    addedRemoved,
  };
  return { commands: [...final, ...added], overlay, added: allAdded, report };
}
