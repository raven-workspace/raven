import { create } from "zustand";
import type { PasteContext } from "../../engines/payloads/context";
import type { SqlEngine, SqlPoint, SqlValues } from "../../engines/payloads/sql";
import type { FilterId } from "../../engines/payloads/filters";
import type { GeneratorId, ListenerId, ToolId } from "../../engines/payloads/types";
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
  /** SQL steps and run commands you copied (by id): they fold to one line. */
  sqlCopied?: string[];
  /** You say callbacks can't get out: reverse payloads are marked, binds come first. Raven never sets this itself. */
  callbacksBlocked?: boolean;
  /** The wrapper for a filtered injection point; applies only in FILTER_CONTEXTS. */
  filter?: FilterId;
  /** Your ticks, over what the log shows. */
  tools?: Partial<Record<ToolId, "present" | "missing">>;
}

interface PayloadsState {
  /** The right-edge drawer is showing. */
  open: boolean;
  generator: GeneratorId;
  /** Keyed by host id. Never written to disk. */
  overrides: Record<string, PayloadOverride>;
  /** LHOST typed in the drawer, over Settings' attacker IP, for this session; null uses Settings. */
  lhost: string | null;
  /** The listener you picked for a payload, by payload id, for this session. */
  listenerPick: Record<string, ListenerId>;
  /** Opens or closes the drawer. Opening closes Notes (they share the right edge; the Arsenal store closes itself). */
  toggle: () => void;
  /** Opens the drawer on one generator (the Arsenal's and ⌘K's way in). */
  show: (g: GeneratorId) => void;
  close: () => void;
  setGenerator: (g: GeneratorId) => void;
  override: (hostId: string, patch: PayloadOverride) => void;
  setLhost: (lhost: string | null) => void;
  pickListener: (payloadId: string, id: ListenerId) => void;
}

export const usePayloadsStore = create<PayloadsState>()((set, get) => ({
  open: false,
  generator: "shell",
  overrides: {},
  lhost: null,
  listenerPick: {},
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
  pickListener: (payloadId, id) => set((s) => ({ listenerPick: { ...s.listenerPick, [payloadId]: id } })),
}));

// Notes and the drawer share the right edge: opening Notes closes the drawer.
useNotesStore.subscribe((s) => {
  if (s.open && usePayloadsStore.getState().open) usePayloadsStore.getState().close();
});
