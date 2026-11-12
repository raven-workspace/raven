import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Node as PMNode } from "prosekit/pm/model";

/**
 * Which evidence chips are open (§10.2): editor view state only, never stored in the document. "Open all" and "Close
 * all" set the default and forget each chip's own choice; a chip opened or closed after that keeps its own.
 */
interface ChipState {
  allOpen: boolean;
  isOpen(key: string): boolean;
  setOpen(key: string, open: boolean): void;
  setAll(open: boolean): void;
}

const ChipStateContext = createContext<ChipState>({ allOpen: false, isOpen: () => false, setOpen: () => {}, setAll: () => {} });

export function ChipStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ all: boolean; own: Map<string, boolean> }>({ all: false, own: new Map() });
  const value = useMemo(
    (): ChipState => ({
      allOpen: state.all,
      isOpen: (key) => state.own.get(key) ?? state.all,
      setOpen: (key, open) => setState((s) => ({ all: s.all, own: new Map(s.own).set(key, open) })),
      setAll: (all) => setState({ all, own: new Map() }),
    }),
    [state],
  );
  return <ChipStateContext.Provider value={value}>{children}</ChipStateContext.Provider>;
}

/** A chip's key: an evidence node's `entryId:block`, an exploit's `fileId`. */
export function chipKey(node: PMNode): string {
  if (node.type.name === "exploit") return String(node.attrs.fileId);
  return `${String(node.attrs.entryId)}:${String(node.attrs.block)}`;
}

/** The node types that show as chips inside a step. */
export const CHIP_TYPES = new Set(["evidence", "exploit"]);

export function useChip(key: string): { open: boolean; setOpen(v: boolean): void } {
  const { isOpen, setOpen } = useContext(ChipStateContext);
  return { open: isOpen(key), setOpen: (v) => setOpen(key, v) };
}

export function useChipsAll(): { allOpen: boolean; setAll(v: boolean): void } {
  const { allOpen, setAll } = useContext(ChipStateContext);
  return { allOpen, setAll };
}

/** The chip state for handlers that run outside render (the page's keys): always the current one. */
export function useChipControls(): { isOpen(key: string): boolean; setOpen(key: string, open: boolean): void } {
  const state = useContext(ChipStateContext);
  const live = useRef(state);
  useEffect(() => {
    live.current = state;
  });
  const isOpen = useCallback((key: string) => live.current.isOpen(key), []);
  const setOpen = useCallback((key: string, open: boolean) => live.current.setOpen(key, open), []);
  return useMemo(() => ({ isOpen, setOpen }), [isOpen, setOpen]);
}
