import { create } from "zustand";
import type { PasteContext } from "../../engines/payloads/context";
import type { SqlEngine, SqlPoint, SqlValues } from "../../engines/payloads/sql";
import type { GeneratorId } from "../../engines/payloads/types";
import { useNotesStore } from "../notes/useNotesStore";

/** What you picked over the inferred value for one host. Wins over inference; lasts the session (memory only). */
export interface PayloadOverride {
  os?: "linux" | "windows";
  context?: PasteContext;
  /** The listener port (LPORT). */
  port?: string;
  /** The SQL panel's engine, injection point, and the values found along the way (column count, table...). */
  sqlEngine?: SqlEngine;
  sqlPoint?: SqlPoint;
  sqlValues?: SqlValues;
}

interface PayloadsState {
  /** The right-edge drawer is showing. */
  open: boolean;
  generator: GeneratorId;
  /** Keyed by host id. Never written to disk. */
  overrides: Record<string, PayloadOverride>;
  /** LHOST typed in the drawer, over Settings' attacker IP, for this session; null uses Settings. */
  lhost: string | null;
  /** Opens or closes the drawer. Opening closes Notes (they share the right edge; the Arsenal store closes itself). */
  toggle: () => void;
  /** Opens the drawer on one generator (the Arsenal's and ⌘K's way in). */
  show: (g: GeneratorId) => void;
  close: () => void;
  setGenerator: (g: GeneratorId) => void;
  override: (hostId: string, patch: PayloadOverride) => void;
  setLhost: (lhost: string | null) => void;
}

export const usePayloadsStore = create<PayloadsState>()((set, get) => ({
  open: false,
  generator: "shell",
  overrides: {},
  lhost: null,
  toggle: () => {
    if (get().open) return get().close();
    if (useNotesStore.getState().open) useNotesStore.getState().close();
    set({ open: true });
  },
  show: (generator) => {
    if (useNotesStore.getState().open) useNotesStore.getState().close();
    set({ open: true, generator });
  },
  close: () => set({ open: false }),
  setGenerator: (generator) => set({ generator }),
  override: (hostId, patch) => set((s) => ({ overrides: { ...s.overrides, [hostId]: { ...s.overrides[hostId], ...patch } } })),
  setLhost: (lhost) => set({ lhost }),
}));

// Notes and the drawer share the right edge: opening Notes closes the drawer.
useNotesStore.subscribe((s) => {
  if (s.open && usePayloadsStore.getState().open) usePayloadsStore.getState().close();
});
