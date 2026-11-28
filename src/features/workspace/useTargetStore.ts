import { create } from "zustand";

interface TargetState {
  /** The Target per engagement: the host last in view. Ids only, in memory, cleared on lock. */
  byEngagement: Record<string, string>;
  pick: (engagementId: string, hostId: string) => void;
  reset: () => void;
}

/**
 * Target, the host in view (GLOSSARY, design §1.3): the one piece of state behind the Target picker, the Explorer's
 * selected host and, later, the host a new session pins. The workspace shell sets it from the page in view (a host's
 * page or its notes), so selecting a host in the Explorer, picking one in the Target picker and switching tabs all land
 * here; a page with no host keeps the last one.
 */
export const useTargetStore = create<TargetState>()((set) => ({
  byEngagement: {},
  pick: (engagementId, hostId) =>
    set((s) => (s.byEngagement[engagementId] === hostId ? s : { byEngagement: { ...s.byEngagement, [engagementId]: hostId } })),
  reset: () => set({ byEngagement: {} }),
}));
