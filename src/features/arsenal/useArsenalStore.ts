import { create } from "zustand";
import { useNotesStore } from "../notes/useNotesStore";

interface ArsenalState {
  /** The right-edge drawer is showing. */
  open: boolean;
  /** The card being read (drawer and browse); null shows search results. */
  cardId: string | null;
  /** Opens the drawer, on a card when given, else on search. Closes Notes (they share the right edge). */
  openCard: (cardId?: string) => void;
  toggle: () => void;
  close: () => void;
  /** Hands the drawer over to the browse screen: the drawer closes, the card stays. */
  fullScreen: () => void;
}

export const useArsenalStore = create<ArsenalState>()((set, get) => ({
  open: false,
  cardId: null,
  openCard: (cardId) => {
    if (useNotesStore.getState().open) useNotesStore.getState().close();
    set({ open: true, cardId: cardId ?? null });
  },
  toggle: () => (get().open ? get().close() : get().openCard(get().cardId ?? undefined)),
  close: () => set({ open: false }),
  fullScreen: () => set({ open: false }),
}));

// Notes and the drawer share the right edge: opening Notes closes the drawer.
useNotesStore.subscribe((s) => {
  if (s.open && useArsenalStore.getState().open) useArsenalStore.getState().close();
});
