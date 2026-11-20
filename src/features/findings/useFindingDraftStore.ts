import { create } from "zustand";
import type { Draft } from "./FindingEditor/FindingEditor";

/** One draft per engagement, host page and finding (`new` for one not yet saved). */
export const draftKey = (eid: string, hostId: string | null, findingId: string | null) =>
  `${eid}:${hostId ?? ""}:${findingId ?? "new"}`;

interface FindingDraftState {
  drafts: Record<string, Draft>;
  get: (key: string) => Draft | undefined;
  set: (key: string, d: Draft) => void;
  drop: (key: string) => void;
  /** Drops every draft of one finding, whichever host page it was opened from (after it is saved). */
  dropFinding: (findingId: string) => void;
  clearAll: () => void;
  /** Why a save failed after its form was gone (H, navigating away): shown once, when the draft comes back. */
  saveErrors: Record<string, string>;
  setSaveError: (key: string, message: string) => void;
  /** Returns and clears the failure for `key`. */
  takeSaveError: (key: string) => string | undefined;
}

/**
 * Unsaved finding drafts, kept when the split closes so "Add finding" picks up where the user left off.
 * Memory only (no `persist`): draft text never reaches disk unencrypted, and a lock or an app restart clears it.
 */
export const useFindingDraftStore = create<FindingDraftState>()((set, get) => ({
  drafts: {},
  saveErrors: {},
  setSaveError: (key, message) => set((s) => ({ saveErrors: { ...s.saveErrors, [key]: message } })),
  takeSaveError: (key) => {
    const message = get().saveErrors[key];
    if (message !== undefined) {
      set((s) => {
        const saveErrors = { ...s.saveErrors };
        delete saveErrors[key];
        return { saveErrors };
      });
    }
    return message;
  },
  get: (key) => get().drafts[key],
  set: (key, d) => set((s) => ({ drafts: { ...s.drafts, [key]: d } })),
  drop: (key) =>
    set((s) => {
      if (!(key in s.drafts)) return s;
      const drafts = { ...s.drafts };
      delete drafts[key];
      return { drafts };
    }),
  dropFinding: (findingId) =>
    set((s) => {
      const keys = Object.keys(s.drafts).filter((k) => k.endsWith(`:${findingId}`));
      if (keys.length === 0) return s;
      const drafts = { ...s.drafts };
      for (const k of keys) delete drafts[k];
      return { drafts };
    }),
  clearAll: () => set({ drafts: {}, saveErrors: {} }),
}));
