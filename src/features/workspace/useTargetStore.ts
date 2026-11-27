import { create } from "zustand";

interface TargetState {
  /** The Target per engagement: the host last in view. Ids only, in memory, cleared on lock. */
  byEngagement: Record<string, string>;
  pick: (engagementId: string, hostId: string) => void;
  reset: () => void;
}

/**
 * Target, the host in view (GLOSSARY): set by opening a host's page, and kept on pages with no host. The Explorer
 * sets it too once it exists (RAV-77).
 */
export const useTargetStore = create<TargetState>()((set) => ({
  byEngagement: {},
  pick: (engagementId, hostId) =>
    set((s) => (s.byEngagement[engagementId] === hostId ? s : { byEngagement: { ...s.byEngagement, [engagementId]: hostId } })),
  reset: () => set({ byEngagement: {} }),
}));
