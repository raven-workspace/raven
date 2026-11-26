import { create } from 'zustand';
import { BUILTIN_LIBRARY } from './data';
import { FIELD_MANUAL_CARDS } from './data/fieldManual';
import type { ToolkitEntry } from '../fieldManual/parseToolkit';
import type { CardMeta, LibraryCommand } from './types';

/**
 * The runtime library as one value: the built-ins until `setImported` layers imported commands and cards over them,
 * with the version that counts the imports. Each import makes a new value, so the value is its own memo dependency.
 */
export interface LibrarySnapshot {
  commands: LibraryCommand[];
  cards: CardMeta[];
  version: number;
}

/** The Toolkit table from the last import (what to transfer, where it lives) and the library version. Empty before any import. */
export interface ToolkitSnapshot {
  toolkit: ToolkitEntry[];
  version: number;
}

const useStore = create<{ library: LibrarySnapshot; toolkit: ToolkitSnapshot }>(() => ({
  library: { commands: BUILTIN_LIBRARY, cards: FIELD_MANUAL_CARDS, version: 0 },
  toolkit: { toolkit: [], version: 0 },
}));

/** The library, for a React view: it re-renders when an import changes it. */
export const useLibrary = (): LibrarySnapshot => useStore((s) => s.library);

/** The Toolkit, for a React view: it re-renders when an import changes it. */
export const useToolkit = (): ToolkitSnapshot => useStore((s) => s.toolkit);

/** The library now, outside React (the checklist's tick context). */
export const currentLibrary = (): LibrarySnapshot => useStore.getState().library;

/**
 * Replaces the imported layer. Imported commands replace built-ins with the same id; new ids are appended.
 * Always applied over the built-ins, so applying the same list twice gives the same library, and an empty layer gives
 * the built-ins: the one place the built-in fallback applies.
 */
export function setImported(imported: { commands: LibraryCommand[]; cards: CardMeta[]; toolkit?: ToolkitEntry[] }): void {
  const byId = new Map(imported.commands.map((c) => [c.id, c]));
  const builtinIds = new Set(BUILTIN_LIBRARY.map((c) => c.id));
  const commands = imported.commands.length === 0
    ? BUILTIN_LIBRARY
    : [
        ...BUILTIN_LIBRARY.map((c) => byId.get(c.id) ?? c),
        ...imported.commands.filter((c) => !builtinIds.has(c.id)),
      ];
  const importedCards = new Map(imported.cards.map((c) => [c.id, c]));
  const cards = imported.cards.length === 0
    ? FIELD_MANUAL_CARDS
    : [
        ...FIELD_MANUAL_CARDS.map((c) => importedCards.get(c.id) ?? c),
        ...imported.cards.filter((c) => !FIELD_MANUAL_CARDS.some((f) => f.id === c.id)),
      ];
  useStore.setState((s) => {
    const version = s.library.version + 1;
    return { library: { commands, cards, version }, toolkit: { toolkit: imported.toolkit ?? [], version } };
  });
}
