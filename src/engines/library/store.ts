import { create } from 'zustand';
import { BUILTIN_LIBRARY } from './data';
import { FIELD_MANUAL_CARDS } from './data/fieldManual';
import type { LibraryCommand } from './types';

export interface CardMeta {
  id: string;
  title: string;
  stage: string;
  category: string;
  os: 'linux' | 'windows' | 'any';
  /** Path relative to the Field-Manual vault. */
  file: string;
}

let library: LibraryCommand[] = BUILTIN_LIBRARY;
let cards: CardMeta[] = FIELD_MANUAL_CARDS;

const useVersion = create<{ version: number }>(() => ({ version: 0 }));

/** The runtime library: the built-ins until `setImported` layers imported commands over them. Synchronous. */
export const getLibrary = (): LibraryCommand[] => library;

/** Card metadata for the commands in the library. */
export const getCards = (): CardMeta[] => cards;

/** Bumps on every `setImported`, so React views (and caches such as kind.ts's bins) know to recompute. */
export const useLibraryVersion = (): number => useVersion((s) => s.version);

/** Non-hook read, for module-level caches. */
export const libraryVersion = (): number => useVersion.getState().version;

/**
 * Replaces the imported layer. Imported commands replace built-ins with the same id; new ids are appended.
 * Always applied over the built-ins, so applying the same list twice gives the same library.
 */
export function setImported(imported: { commands: LibraryCommand[]; cards: CardMeta[] }): void {
  const byId = new Map(imported.commands.map((c) => [c.id, c]));
  const builtinIds = new Set(BUILTIN_LIBRARY.map((c) => c.id));
  library = imported.commands.length === 0
    ? BUILTIN_LIBRARY
    : [
        ...BUILTIN_LIBRARY.map((c) => byId.get(c.id) ?? c),
        ...imported.commands.filter((c) => !builtinIds.has(c.id)),
      ];
  const importedCards = new Map(imported.cards.map((c) => [c.id, c]));
  cards = imported.cards.length === 0
    ? FIELD_MANUAL_CARDS
    : [
        ...FIELD_MANUAL_CARDS.map((c) => importedCards.get(c.id) ?? c),
        ...imported.cards.filter((c) => !FIELD_MANUAL_CARDS.some((f) => f.id === c.id)),
      ];
  useVersion.setState((s) => ({ version: s.version + 1 }));
}
