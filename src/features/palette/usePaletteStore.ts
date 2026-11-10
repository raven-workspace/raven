import { create } from "zustand";

interface PaletteState {
  isOpen: boolean;
  /** A host chosen by the opener; otherwise the palette follows the host in the route. */
  hostId: string | null;
  /** Element focused when the palette opened; it gets focus back on close. */
  returnFocus: HTMLElement | null;
  /** The palette closed into a page that places focus itself (a Manual hit): nothing takes focus back. */
  handOff: boolean;
  open: (hostId?: string) => void;
  close: (opts?: { handOff?: boolean }) => void;
}

export const usePaletteStore = create<PaletteState>()((set) => ({
  isOpen: false,
  hostId: null,
  returnFocus: null,
  handOff: false,
  open: (hostId) => {
    const active = document.activeElement;
    set({ isOpen: true, hostId: hostId ?? null, handOff: false, returnFocus: active instanceof HTMLElement && active !== document.body ? active : null });
  },
  close: (opts) => set({ isOpen: false, hostId: null, handOff: opts?.handOff ?? false }),
}));
