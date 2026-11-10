import { create } from "zustand";
import type { LibraryCommand } from "../../engines/library/types";
import { useNotesStore } from "../notes/useNotesStore";
import { usePayloadsStore } from "../payloads/usePayloadsStore";

interface ArsenalState {
  /** The right-edge drawer is showing. */
  open: boolean;
  /** The card being read (drawer and browse); null shows search results. */
  cardId: string | null;
  /** The command block (a `LibraryCommand.id`) the card opens scrolled to; null for the top of the card. */
  blockId: string | null;
  /** A card-less command shown alone in the drawer (the reading view); null when none. */
  solo: LibraryCommand | null;
  /** The drawer was opened from the Manual: its first Esc closes it, however far it navigated inside. */
  fromManual: boolean;
  /** What full-screen browse showed last, so it opens where you stopped. */
  lastRead: { kind: "card" | "command" | "generator"; id: string } | null;
  /** Opens the drawer on one command shown alone (a built-in command has no card). Closes Notes. */
  openSolo: (command: LibraryCommand) => void;
  /** Leaves the solo view (the drawer stays as it is). */
  clearSolo: () => void;
  /** Opens the drawer, on a card (at one of its blocks) when given, else on search. Closes Notes (they share the right edge). */
  openCard: (cardId?: string, blockId?: string, opts?: { from?: "manual" }) => void;
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
  lastRead: null,
  fromManual: false,
  openSolo: (command) => {
    if (useNotesStore.getState().open) useNotesStore.getState().close();
    set({ open: true, cardId: null, blockId: null, solo: command });
  },
  clearSolo: () => set({ solo: null }),
  openCard: (cardId, blockId, opts) => {
    if (useNotesStore.getState().open) useNotesStore.getState().close();
    // Moves inside an open drawer keep where it was opened from.
    const fromManual = opts?.from === "manual" || (get().open && get().fromManual);
    set({ open: true, fromManual, solo: null, cardId: cardId ?? null, blockId: cardId ? (blockId ?? null) : null });
  },
  toggle: () => (get().open ? get().close() : get().openCard(get().cardId ?? undefined, get().blockId ?? undefined)),
  close: () => set({ open: false, fromManual: false }),
  fullScreen: () => set({ open: false, fromManual: false }),
}));

// Notes and the drawer share the right edge: opening Notes closes the drawer.
useNotesStore.subscribe((s) => {
  if (s.open && useArsenalStore.getState().open) useArsenalStore.getState().close();
});

// Payloads share the right edge too: whichever opens last stays.
usePayloadsStore.subscribe((s) => {
  if (s.open && useArsenalStore.getState().open) useArsenalStore.getState().close();
});
useArsenalStore.subscribe((s) => {
  if (s.open && usePayloadsStore.getState().open) usePayloadsStore.getState().close();
});
