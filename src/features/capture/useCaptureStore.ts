import { create } from "zustand";
import type { Host } from "../../types/host";
import type { FlagKind, LogKind } from "../../types/log";
import { releaseImage, type PastedImage } from "./imagePaste";

/**
 * What the user has put into the capture panel. `null` on an override means "use the
 * suggestion": the kind, hosts, ran-on and flag kind follow the paste until the user picks one.
 */
export interface PanelDraft {
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

export const EMPTY_DRAFT: PanelDraft = {
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

interface CaptureState {
  open: boolean;
  engagementId: string | null;
  /** Host preselected when capture was opened from its host view. */
  hostId: string | null;
  /** Element focused when `L` was pressed; it gets focus back on close. */
  returnFocus: HTMLElement | null;
  /** Unsaved drafts, per engagement. */
  drafts: Record<string, PanelDraft>;
  /** Shown in the panel after a partial save. */
  notice: string | null;
  openCapture: (o: { engagementId: string; hostId?: string | null }) => void;
  close: () => void;
  update: (engagementId: string, patch: Partial<PanelDraft>) => void;
  discard: (engagementId: string) => void;
  setNotice: (notice: string | null) => void;
  reset: () => void;
}

const initial = { open: false, engagementId: null, hostId: null, returnFocus: null, drafts: {}, notice: null };

export const useCaptureStore = create<CaptureState>()((set, get) => ({
  ...initial,
  openCapture: ({ engagementId, hostId = null }) => {
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
