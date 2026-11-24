import { create } from "zustand";
import type { LibraryCommand } from "../../engines/library/types";
import { registerDrawer } from "../drawers";

interface ArsenalState {
  /** The right-edge drawer is showing. */
  open: boolean;
  /** The card being read (drawer and browse); null shows search results. */
  cardId: string | null;
  /** The command block (a `LibraryCommand.id`) the card opens scrolled to; null for the top of the card. */
  blockId: string | null;
  /** A card-less command shown alone in the drawer (the reading view); null when none. */
  solo: LibraryCommand | null;
  /**
   * The cards on screen were reached from the Manual (a card opened from a note, then links inside it): the first Esc
   * closes the drawer, back on the note. Opening anything from elsewhere clears it.
   */
  fromManual: boolean;
  /** What full-screen browse showed last, so it opens where you stopped. */
  lastRead: { kind: "card" | "command" | "generator"; id: string } | null;
  /** Opens the drawer on one command shown alone (a built-in command has no card). */
  openSolo: (command: LibraryCommand) => void;
  /** Leaves the solo view (the drawer stays as it is). */
  clearSolo: () => void;
  /**
   * Opens the drawer, on a card (at one of its blocks) when given, else on search. `from`: "manual" for a card opened
   * from a note; "link" for a link inside the card on screen, which keeps where that card came from.
   */
  openCard: (cardId?: string, blockId?: string, opts?: { from?: "manual" | "link" }) => void;
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
    set({ open: true, fromManual: false, cardId: null, blockId: null, solo: command });
  },
  clearSolo: () => set({ solo: null }),
  openCard: (cardId, blockId, opts) => {
    // Only a link inside the card on screen keeps where it was opened from.
    const fromManual = opts?.from === "manual" || (opts?.from === "link" && get().open && get().fromManual);
    set({ open: true, fromManual, solo: null, cardId: cardId ?? null, blockId: cardId ? (blockId ?? null) : null });
  },
  toggle: () => (get().open ? get().close() : get().openCard(get().cardId ?? undefined, get().blockId ?? undefined)),
  close: () => set({ open: false, fromManual: false }),
  fullScreen: () => set({ open: false, fromManual: false }),
}));

registerDrawer("arsenal", useArsenalStore);
