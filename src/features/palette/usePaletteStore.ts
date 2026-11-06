import { create } from "zustand";

interface PaletteState {
  isOpen: boolean;
  /** A host chosen by the opener; otherwise the palette follows the host in the route. */
  hostId: string | null;
  /** Element focused when the palette opened; it gets focus back on close. */
  returnFocus: HTMLElement | null;
  open: (hostId?: string) => void;
  close: () => void;
}

export const usePaletteStore = create<PaletteState>()((set) => ({
  isOpen: false,
  hostId: null,
  returnFocus: null,
  open: (hostId) => {
    const active = document.activeElement;
    set({ isOpen: true, hostId: hostId ?? null, returnFocus: active instanceof HTMLElement && active !== document.body ? active : null });
  },
  close: () => set({ isOpen: false, hostId: null }),
}));
