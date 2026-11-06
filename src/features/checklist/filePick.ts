import { create } from "zustand";

interface FilePickState {
  /** The file picked on a checklist step's {FILE} chip, for one host at a time: another host starts clean. */
  hostId: string;
  file: string;
  set: (hostId: string, file: string) => void;
}

export const useFilePickStore = create<FilePickState>()((set) => ({ hostId: "", file: "", set: (hostId, file) => set({ hostId, file }) }));

/** The pick for `hostId`, or "" (it never carries over to another host). Non-reactive; subscribe with `useFilePickStore`. */
export const filePickFor = (hostId: string): string => {
  const s = useFilePickStore.getState();
  return s.hostId === hostId ? s.file : "";
};

/** FILE and SCRIPT overrides for a pick (SCRIPT is the name without `.ps1`). Empty without a pick. */
export const pickOverrides = (file: string): Record<string, string> => {
  const f = file.trim();
  return f ? { FILE: f, SCRIPT: f.replace(/\.ps1$/i, "") } : {};
};
