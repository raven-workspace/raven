import { create } from "zustand";
import type { ExtractionSummary } from "../../types/log";

interface SaveSummaryState {
  current: { entryId: string; summary: ExtractionSummary } | null;
  /** Shows the summary of a save; a new save replaces the current one. A save that filed nothing shows nothing. */
  show: (entryId: string, summary: ExtractionSummary | null | undefined) => void;
  close: () => void;
}

export const useSaveSummaryStore = create<SaveSummaryState>((set) => ({
  current: null,
  show: (entryId, summary) => {
    if (!summary || summary.wins.length + summary.counts.length + summary.ticks.length === 0) return;
    set({ current: { entryId, summary } });
  },
  close: () => set({ current: null }),
}));
