import { create } from "zustand";
import type { LibraryCommand } from "../../engines/library/types";
import { useNotesStore } from "../notes/useNotesStore";

interface ArsenalState {
  /** The right-edge drawer is showing. */
  open: boolean;
  /** The card being read (drawer and browse); null shows search results. */
  cardId: string | null;
  /** The command block (a `LibraryCommand.id`) the card opens scrolled to; null for the top of the card. */
  blockId: string | null;
  /** A card-less command shown alone in the drawer (the reading view); null when none. */
  solo: LibraryCommand | null;
  /** Opens the drawer on one command shown alone (a built-in command has no card). Closes Notes. */
  openSolo: (command: LibraryCommand) => void;
  /** Leaves the solo view (the drawer stays as it is). */
  clearSolo: () => void;
  /** Opens the drawer, on a card (at one of its blocks) when given, else on search. Closes Notes (they share the right edge). */
  openCard: (cardId?: string, blockId?: string) => void;
  toggle: () => void;
  close: () => void;
  /** Hands the drawer over to the browse screen: the drawer closes, the card stays. */
  fullScreen: () => void;
}

export const useArsenalStore = create<ArsenalState>()((set, get) => ({
  open: false,
  cardId: null,
  blockId: null,
  solo: null,
  openSolo: (command) => {
    if (useNotesStore.getState().open) useNotesStore.getState().close();
    set({ open: true, cardId: null, blockId: null, solo: command });
  },
  clearSolo: () => set({ solo: null }),
  openCard: (cardId, blockId) => {
    if (useNotesStore.getState().open) useNotesStore.getState().close();
    set({ open: true, solo: null, cardId: cardId ?? null, blockId: cardId ? (blockId ?? null) : null });
  },
  toggle: () => (get().open ? get().close() : get().openCard(get().cardId ?? undefined, get().blockId ?? undefined)),
  close: () => set({ open: false }),
  fullScreen: () => set({ open: false }),
}));

// Notes and the drawer share the right edge: opening Notes closes the drawer.
useNotesStore.subscribe((s) => {
  if (s.open && useArsenalStore.getState().open) useArsenalStore.getState().close();
});
