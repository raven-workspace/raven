import { create } from "zustand";
import { CONFIRM_MS } from "../arsenal/copyGuard";

/** `ok` says a copy worked, `warn` that it was held back or half-filled, `muted` is a neutral aside ("No previous note"). */
export type ManualStatusTone = "ok" | "warn" | "muted";

/**
 * The one status line of the Manual (in the host row): what the last copy, hold-back or jump said. It clears itself
 * after `CONFIRM_MS` (as the copy guard's confirm does), so nothing lingers; a newer line restarts the wait.
 */
interface ManualStatus {
  text: string | null;
  tone: ManualStatusTone;
  set(text: string, tone: ManualStatusTone): void;
  clear(): void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useManualStatus = create<ManualStatus>((set) => ({
  text: null,
  tone: "ok",
  set: (text, tone) => {
    clearTimeout(timer);
    timer = setTimeout(() => set({ text: null, tone: "ok" }), CONFIRM_MS);
    set({ text, tone });
  },
  clear: () => {
    clearTimeout(timer);
    timer = undefined;
    set({ text: null, tone: "ok" });
  },
}));
