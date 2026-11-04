import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { RavenError } from "../../types/errors";
import type { Note } from "../../types/notes";

export type NotesScope = "host" | "engagement";

export const NOTES_WIDTH_KEY = "raven.notes.width";
export const MIN_WIDTH = 320;
export const DEFAULT_WIDTH = 440;
const AUTOSAVE_MS = 500;

export interface NoteTarget {
  engagementId: string;
  hostId: string | null;
}

/** Text typed but not yet confirmed saved. */
export interface PendingNote extends NoteTarget {
  body: string;
  private: boolean;
}

export const noteKey = (t: NoteTarget) => `${t.engagementId}:${t.hostId ?? ""}`;

export function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.7));
}

export function clampWidth(w: number): number {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));
}

function storedWidth(): number {
  const n = Number(localStorage.getItem(NOTES_WIDTH_KEY));
  return Number.isFinite(n) && n > 0 ? clampWidth(n) : DEFAULT_WIDTH;
}

interface NotesState {
  open: boolean;
  scope: NotesScope;
  width: number;
  /** Unsaved text per note. Lives here, not in the panel, so a lock can still save it. */
  pending: Record<string, PendingNote>;
  /** The last failed save, per note key. */
  errors: Record<string, string>;
  /** `scope` is the scope to open on; ignored when closing. */
  toggle: (scope?: NotesScope) => void;
  close: () => void;
  setScope: (scope: NotesScope) => void;
  setWidth: (width: number, persist?: boolean) => void;
  /** Records new text and (re)starts the 500 ms autosave. */
  edit: (target: NoteTarget, body: string, isPrivate: boolean) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<void> = Promise.resolve();
let queryClient: QueryClient | null = null;

/** The app's query client, set once at the root so saves refresh the cache even after the shell unmounts. */
export function setNotesQueryClient(qc: QueryClient | null) {
  queryClient = qc;
}

function cacheSaved(note: Note) {
  queryClient?.setQueryData(["note", note.engagementId, note.hostId], note);
  void queryClient?.invalidateQueries({ queryKey: ["notes", note.engagementId] });
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  open: false,
  scope: "engagement",
  width: storedWidth(),
  pending: {},
  errors: {},
  toggle: (scope) => {
    if (get().open) get().close();
    else set({ open: true, ...(scope ? { scope } : {}) });
  },
  close: () => {
    set({ open: false });
    flushQuietly();
  },
  setScope: (scope) => {
    if (scope === get().scope) return;
    flushQuietly();
    set({ scope });
  },
  setWidth: (width, persist = true) => {
    const w = clampWidth(width);
    set({ width: w });
    if (persist) localStorage.setItem(NOTES_WIDTH_KEY, String(w));
  },
  edit: (target, body, isPrivate) => {
    const key = noteKey(target);
    set((s) => ({ pending: { ...s.pending, [key]: { ...target, body, private: isPrivate } } }));
    clearTimeout(timer);
    timer = setTimeout(flushQuietly, AUTOSAVE_MS);
  },
}));

async function flushOnce(snapshot: Record<string, PendingNote>): Promise<void> {
  let failure: unknown;
  for (const [key, p] of Object.entries(snapshot)) {
    try {
      const saved = await api.noteSave(p.engagementId, p.hostId, p.body, p.private);
      cacheSaved(saved);
      useNotesStore.setState((s) => {
        const errors = { ...s.errors };
        delete errors[key];
        const cur = s.pending[key];
        // Text typed while the save ran stays pending (its own autosave is already queued).
        if (!cur || cur.body !== p.body || cur.private !== p.private) return { errors };
        const pending = { ...s.pending };
        delete pending[key];
        return { pending, errors };
      });
    } catch (e) {
      failure ??= e;
      const message = RavenError.from(e).message;
      useNotesStore.setState((s) => ({ errors: { ...s.errors, [key]: message } }));
    }
  }
  if (failure !== undefined) throw failure;
}

/**
 * Saves every pending note now. Saves are serialised. Rejects with the first failure after
 * trying them all; failed text stays pending (and on screen).
 */
export function flushNotes(): Promise<void> {
  clearTimeout(timer);
  // Snapshot now, not when the chain gets to it: a lock clears `pending` right after this call.
  const snapshot = { ...useNotesStore.getState().pending };
  const run = chain.then(() => flushOnce(snapshot));
  chain = run.catch(() => undefined);
  return run;
}

/** Autosave and unmount flushes: failures show in the panel; a `locked` one reaches the vault gate. */
export function flushQuietly(): void {
  void flushNotes().catch(reportError);
}

/** True while any note text is not yet confirmed saved. */
export function hasPendingNotes(): boolean {
  return Object.keys(useNotesStore.getState().pending).length > 0;
}

/** On every lock: note text is never kept in memory. Drops pending text and errors, closes the panel. */
export function discardNotes() {
  clearTimeout(timer);
  useNotesStore.setState({ open: false, pending: {}, errors: {} });
}

/** Test helper: back to a clean store. */
export function resetNotesStore() {
  clearTimeout(timer);
  chain = Promise.resolve();
  useNotesStore.setState({ open: false, scope: "engagement", width: storedWidth(), pending: {}, errors: {} });
}
