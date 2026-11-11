import { useEffect } from "react";
import { create } from "zustand";
import type { Hint } from "./HintLine";

interface PageShortcutsState {
  /** The keys of the page on screen, listed first under the title bar's shortcuts button. */
  page: { title: string; hints: Hint[] } | null;
  set: (page: { title: string; hints: Hint[] } | null) => void;
}

export const usePageShortcutsStore = create<PageShortcutsState>((set) => ({
  page: null,
  set: (page) => set({ page }),
}));

/** Lists this page's keys under the title bar's shortcuts button while the page is mounted. */
export function usePageShortcuts(title: string, hints: Hint[]) {
  useEffect(() => {
    const page = { title, hints };
    usePageShortcutsStore.getState().set(page);
    return () => {
      // A newer page may already have registered its own keys: clear only ours.
      if (usePageShortcutsStore.getState().page === page) usePageShortcutsStore.getState().set(null);
    };
  }, [title, hints]);
}
