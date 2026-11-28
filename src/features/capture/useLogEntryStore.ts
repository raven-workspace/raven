import { create } from "zustand";
import type { Host } from "../../types/host";
import type { FlagKind, LogKind } from "../../types/log";
import { releaseImage, type PastedImage } from "./imagePaste";

/**
 * What the owner has put into the log entry form (the log entry tab, or the sheet in the engagement shell). `null` on an override means "use the
 * suggestion": the kind, hosts, ran-on and flag kind follow the paste until the user picks one.
 */
export interface LogEntryDraft {
  text: string;
  caption: string;
  image: PastedImage | null;
  kind: LogKind | null;
  title: string;
  titleEdited: boolean;
  hostIds: string[] | null;
  /** Hosts a failed save already created; a retry reuses them. */
  created: Host[];
  ranOn: string | null;
  observations: string;
  returnedNothing: boolean;
  private: boolean;
  flagKind: FlagKind | null;
  /** The owner chose to keep a pasted `user:pass` as a note only: no credentials are added. */
  asNote: boolean;
}

export const EMPTY_DRAFT: LogEntryDraft = {
  text: "",
  caption: "",
  image: null,
  kind: null,
  title: "",
  titleEdited: false,
  hostIds: null,
  created: [],
  ranOn: null,
  observations: "",
  returnedNothing: false,
  private: false,
  flagKind: null,
  asNote: false,
};

interface LogEntryState {
  /**
   * A request to open the form (L, the Explorer's Plus). The engagement shell shows its sheet while it holds; the
   * workspace shell turns it into the log entry tab at once and sets it back (useDrawerTabs).
   */
  open: boolean;
  engagementId: string | null;
  /** Host linked to start: the host view's in the engagement shell, Target in the workspace shell. */
  hostId: string | null;
  /** The route in view when the log entry tab opened: Save goes back to its tab (workspace shell). */
  returnRoute: string | null;
  /** Element focused when `L` was pressed; it gets focus back on close. */
  returnFocus: HTMLElement | null;
  /** Unsaved drafts, per engagement. */
  drafts: Record<string, LogEntryDraft>;
  /** Shown in the form after a partial save. */
  notice: string | null;
  openLogEntry: (o: { engagementId: string; hostId?: string | null }) => void;
  close: () => void;
  update: (engagementId: string, patch: Partial<LogEntryDraft>) => void;
  discard: (engagementId: string) => void;
  setNotice: (notice: string | null) => void;
  reset: () => void;
}

const initial = { open: false, engagementId: null, hostId: null, returnRoute: null, returnFocus: null, drafts: {}, notice: null };

export const useLogEntryStore = create<LogEntryState>()((set, get) => ({
  ...initial,
  openLogEntry: ({ engagementId, hostId = null }) => {
    const active = document.activeElement;
    set({
      open: true,
      engagementId,
      hostId,
      notice: null,
      returnFocus: active instanceof HTMLElement && active !== document.body ? active : null,
    });
  },
  close: () => set({ open: false, notice: null }),
  update: (engagementId, patch) =>
    set((s) => {
      const prev = s.drafts[engagementId] ?? EMPTY_DRAFT;
      // New text is a new paste: "keep as note" was a choice about the old one.
      const next = patch.text !== undefined && patch.text !== prev.text && patch.asNote === undefined ? { ...patch, asNote: false } : patch;
      return { drafts: { ...s.drafts, [engagementId]: { ...prev, ...next } } };
    }),
  discard: (engagementId) => {
    const { drafts } = get();
    releaseImage(drafts[engagementId]?.image);
    const rest = { ...drafts };
    delete rest[engagementId];
    set({ drafts: rest });
  },
  setNotice: (notice) => set({ notice }),
  reset: () => {
    Object.values(get().drafts).forEach((d) => releaseImage(d.image));
    set(initial);
  },
}));
