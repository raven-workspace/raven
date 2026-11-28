import { create } from "zustand";

export const EXPLORER_KEY = "raven.explorer.open";

/** Open unless the owner closed it: it never hides on its own, even at 1100px (design §1.7). */
function storedOpen(): boolean {
  try {
    return localStorage.getItem(EXPLORER_KEY) !== "0";
  } catch {
    return true;
  }
}

interface ExplorerState {
  /** Whether the Explorer column shows. ⌘B or the rail's Explorer item toggles it. */
  open: boolean;
  /** Host ids whose services are showing, in memory only. */
  expanded: Record<string, true>;
  /** The Add host dialog, which ⌘N opens even while the Explorer is closed. */
  addingHost: boolean;
  toggle: () => void;
  toggleHost: (hostId: string) => void;
  setAddingHost: (adding: boolean) => void;
  reset: () => void;
}

/** The Explorer's own state (design §1.4). */
export const useExplorerStore = create<ExplorerState>()((set, get) => ({
  open: storedOpen(),
  expanded: {},
  addingHost: false,
  toggle: () => {
    const open = !get().open;
    try {
      localStorage.setItem(EXPLORER_KEY, open ? "1" : "0");
    } catch {
      // Storage refused: the toggle still holds for this run.
    }
    set({ open });
  },
  toggleHost: (hostId) =>
    set((s) => {
      const expanded = { ...s.expanded };
      if (expanded[hostId]) delete expanded[hostId];
      else expanded[hostId] = true;
      return { expanded };
    }),
  setAddingHost: (addingHost) => set({ addingHost }),
  reset: () => set({ expanded: {}, addingHost: false }),
}));
