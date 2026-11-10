import { create } from "zustand";

/** The one status line of the Manual (in the host row): what the last copy, hold-back or jump said. */
interface ManualStatus {
  text: string | null;
  tone: "ok" | "warn";
  set(text: string, tone: "ok" | "warn"): void;
  clear(): void;
}

export const useManualStatus = create<ManualStatus>((set) => ({
  text: null,
  tone: "ok",
  set: (text, tone) => set({ text, tone }),
  clear: () => set({ text: null, tone: "ok" }),
}));
