import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { RavenError } from "../../types/errors";
import type { Note } from "../../types/notes";
import { clearThreadCounts } from "./useThreadCounts";
import { registerDrawer } from "../drawers";

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
/** Bumped on every lock and unlock; a save that started in an earlier session writes nothing back. */
let generation = 0;
export const sessionGeneration = () => generation;
export function startNotesSession() {
  generation++;
}

let queryClient: QueryClient | null = null;

/** The app's query client, set once at the root so saves refresh the cache even after the shell unmounts. */
export function setNotesQueryClient(qc: QueryClient | null) {
  queryClient = qc;
}

/**
 * Writes a saved note into both caches before its pending text is dropped: the panel's `["note", …]` and the
 * engagement's `["notes", …]` list that thread counts read. Without the list write, dropping the pending text made
 * the counts fall back to the list's old body (a closed thread counted again) until the refetch landed, or for good
 * if it failed. The refetch still runs, to pick up anything else that changed.
 */
function cacheSaved(note: Note) {
  if (!queryClient) return;
  queryClient.setQueryData(["note", note.engagementId, note.hostId], note);
  queryClient.setQueryData<Note[]>(["notes", note.engagementId], (list) => {
    if (!list) return list;
    const i = list.findIndex((n) => n.ownerId === note.ownerId);
    return i === -1 ? [...list, note] : list.map((n, j) => (j === i ? note : n));
  });
  void queryClient.invalidateQueries({ queryKey: ["notes", note.engagementId] });
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
registerDrawer("notes", useNotesStore);

async function flushOnce(snapshot: Record<string, PendingNote>): Promise<void> {
  let failure: unknown;
  const gen = generation;
  for (const [key, p] of Object.entries(snapshot)) {
    if (gen !== generation) return;
    try {
      const saved = await api.noteSave(p.engagementId, p.hostId, p.body, p.private);
      if (gen !== generation) return; // locked meanwhile: nothing from this save may reach memory
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
      if (gen !== generation) return;
      failure ??= e;
      const message = RavenError.from(e).message;
      // Text dropped meanwhile (its host or engagement was deleted) has no error to show.
      useNotesStore.setState((s) => (s.pending[key] ? { errors: { ...s.errors, [key]: message } } : s));
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

/**
 * Drops unsaved text whose note is gone, so it neither retries a save that can only fail nor counts as threads:
 * a deleted host's note (`hostId`), or every note of a deleted engagement (`hostId` left out).
 */
export function dropPendingNotes(engagementId: string, hostId?: string): void {
  const gone = (p: NoteTarget) => p.engagementId === engagementId && (hostId === undefined || p.hostId === hostId);
  useNotesStore.setState((s) => {
    const keys = Object.entries(s.pending).filter(([, p]) => gone(p)).map(([k]) => k);
    if (keys.length === 0) return s;
    const pending = { ...s.pending };
    const errors = { ...s.errors };
    for (const k of keys) {
      delete pending[k];
      delete errors[k];
    }
    return { pending, errors };
  });
}

/** True while any note text is not yet confirmed saved. */
export function hasPendingNotes(): boolean {
  return Object.keys(useNotesStore.getState().pending).length > 0;
}

/** On every lock: note text is never kept in memory. Drops pending text and errors, closes the panel. */
export function discardNotes() {
  clearTimeout(timer);
  generation++;
  useNotesStore.setState({ open: false, pending: {}, errors: {} });
  // Thread counts cache note bodies (saved and pending): they go too.
  clearThreadCounts();
}

/** Test helper: back to a clean store. */
export function resetNotesStore() {
  clearTimeout(timer);
  chain = Promise.resolve();
  useNotesStore.setState({ open: false, scope: "engagement", width: storedWidth(), pending: {}, errors: {} });
}
