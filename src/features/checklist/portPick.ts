import { create } from "zustand";

interface PortPickState {
  /** The port picked on a step's {PORT} chip, by "hostId|goalId". Absent: the lowest matching port. */
  picks: Record<string, number>;
  set: (key: string, port: number) => void;
}

export const usePortPickStore = create<PortPickState>()((set) => ({ picks: {}, set: (key, port) => set((s) => ({ picks: { ...s.picks, [key]: port } })) }));

export const portPickKey = (hostId: string, goalId: string) => `${hostId}|${goalId}`;
