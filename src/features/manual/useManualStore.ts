import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Where the owner is in the Manual: a note and how far down it. No engagement data. */
export interface ManualPlace {
  noteId: string;
  scrollTop: number;
}

interface ManualState {
  /** The last note read and its scroll offset. The only part that persists (across restarts). */
  place: ManualPlace | null;
  /** Notes left by following a link or the rail, newest last. Session only: ⌘[ walks it back. */
  history: ManualPlace[];
  setPlace: (p: ManualPlace) => void;
  push: (p: ManualPlace) => void;
  /** Takes the newest entry off the history, or null when there is none. */
  back: () => ManualPlace | null;
}

const HISTORY_MAX = 50;

export const useManualStore = create<ManualState>()(
  persist(
    (set, get) => ({
      place: null,
      history: [],
      setPlace: (p) => set({ place: { noteId: p.noteId, scrollTop: Math.max(0, Math.round(p.scrollTop)) } }),
      push: (p) => set({ history: [...get().history, { noteId: p.noteId, scrollTop: p.scrollTop }].slice(-HISTORY_MAX) }),
      back: () => {
        const h = get().history;
        const last = h.at(-1) ?? null;
        if (last) set({ history: h.slice(0, -1) });
        return last;
      },
    }),
    {
      name: "raven.manual.place",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ place: s.place ? { noteId: s.place.noteId, scrollTop: s.place.scrollTop } : null }),
    },
  ),
);
