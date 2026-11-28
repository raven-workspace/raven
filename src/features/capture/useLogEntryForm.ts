import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import { metasploitHostIds, metasploitWarning } from "../../engines/checklist/index";
import { useLibrary } from "../../engines/library/store";
import { matches, SHORTCUTS } from "../../lib/shortcuts";
import type { Engagement } from "../../types/engagement";
import { RavenError } from "../../types/errors";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { useHosts } from "../hosts/queries";
import { EntryChangeError } from "../log/entryChange";
import { useLog } from "../log/queries";
import { useSettings } from "../settings/queries";
import { clipboardImage, readImage, releaseImage } from "./imagePaste";
import { KINDS, resolveCapture } from "./resolve";
import { saveCapture } from "./saveCapture";
import { EMPTY_DRAFT, useLogEntryStore, type LogEntryDraft } from "./useLogEntryStore";

const NO_HOSTS: Host[] = [];
const NO_MACHINES: string[] = [];

export interface LogEntryFormOptions {
  engagement: Engagement;
  pasteRef: RefObject<HTMLElement | null>;
  /** The entry is written and the draft gone: the sheet closes, the tab closes and returns to the tab before it. */
  onSaved: () => void;
  /** The draft is cleared: the sheet stays open on an empty paste area, the tab closes. */
  onDiscarded: () => void;
}

/**
 * The log entry form's state and logic, shared by the log entry tab (workspace shell, design §2.5) and the sheet the
 * engagement shell still opens: the draft, what it resolves to, its keys, image paste and save. The two only lay it out
 * differently.
 */
export function useLogEntryForm({ engagement, pasteRef, onSaved, onDiscarded }: LogEntryFormOptions) {
  const id = engagement.id;
  const qc = useQueryClient();
  const hostsQ = useHosts(id);
  const listed = hostsQ.data ?? NO_HOSTS;
  const machines = useSettings().data?.machines ?? NO_MACHINES;
  const library = useLibrary();
  const pd = useLogEntryStore((s) => s.drafts[id]) ?? EMPTY_DRAFT;
  // Hosts a failed save already created count as known, even before the list refetches.
  const hosts = useMemo(
    () => (pd.created.length ? [...listed, ...pd.created.filter((c) => !listed.some((h) => h.id === c.id))] : listed),
    [listed, pd.created],
  );
  const presetHostId = useLogEntryStore((s) => s.hostId);
  const log = useLog(id).data;
  const notice = useLogEntryStore((s) => s.notice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const focusCaption = useRef(false);

  const r = useMemo(
    () =>
      resolveCapture(pd, {
        hosts,
        scope: engagement.scopeCidrs,
        domain: engagement.domain ?? "",
        machines,
        lastRanOn: engagement.lastRanOn,
        library: library.commands,
        presetHostId,
        log,
      }),
    [pd, hosts, machines, engagement, presetHostId, log, library],
  );
  const kind = r.edits.kind;
  // Exam sims: warn (without blocking) when this entry uses Metasploit off the locked host.
  const msfWarning = useMemo(() => {
    if (engagement.kind !== "exam-sim" || !engagement.msfHostId) return null;
    const draft: LogEntry = {
      id: "", engagementId: id, kind: r.edits.kind, title: "", titleEdited: false, ranOn: r.edits.ranOn || null,
      hostIds: r.edits.hostIds, observations: null, returnedNothing: false, private: false, content: r.edits.content,
      at: 0, createdAt: 0, updatedAt: 0,
    };
    return metasploitWarning(draft, engagement, metasploitHostIds(draft, engagement, hosts));
  }, [engagement, hosts, id, r.edits]);
  const set = (patch: Partial<LogEntryDraft>) => useLogEntryStore.getState().update(id, patch);

  // After an image paste the caption is the next thing to type.
  useEffect(() => {
    if (focusCaption.current && captionRef.current) {
      focusCaption.current = false;
      captionRef.current.focus();
    }
  }, [pd.image]);

  async function save() {
    if (saving || !r.canSave) return;
    setSaving(true);
    setError(null);
    const store = useLogEntryStore.getState();
    const image = pd.image && (kind === "screenshot" || kind === "flag") ? { mime: pd.image.mime, dataBase64: pd.image.dataBase64 } : null;
    // The save reports its own store change, summary and errors (the entry change); this form shows what's left.
    try {
      await saveCapture(qc, {
        engagementId: id,
        draft: r.draft,
        draftInput: r.draftInput,
        edits: r.edits,
        image,
        hosts,
        onHostCreated: (h) => {
          const cur = useLogEntryStore.getState().drafts[id]?.created ?? [];
          set({ created: [...cur, h] });
        },
      });
      store.discard(id);
      onSaved();
    } catch (e) {
      if (e instanceof EntryChangeError) {
        // The entry is saved: the draft goes, so Save does not create it twice.
        store.discard(id);
        store.setNotice(e.message);
      } else {
        // Nothing was saved; the draft stays for a retry.
        setError(RavenError.from(e).message);
      }
    } finally {
      setSaving(false);
    }
  }

  /** Enter saves; Shift+Enter is a newline. */
  function enterSaves(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void save();
  }

  /** In a note, Enter saves only while the text is one line (R9). */
  function noteEnter(e: KeyboardEvent<HTMLElement>) {
    if (!pd.text.trim().includes("\n")) enterSaves(e);
  }

  /** The form's chords (⌘ on macOS, Ctrl on Linux); other modifiers with them do nothing. */
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const n = SHORTCUTS.captureKinds.findIndex((sc) => matches(sc, e));
    if (n >= 0 && n < KINDS.length) set({ kind: KINDS[n]!.kind });
    else if (matches(SHORTCUTS.capturePrivate, e)) set({ private: !pd.private });
    else if (matches(SHORTCUTS.captureReturnedNothing, e) && kind === "command") set({ returnedNothing: !pd.returnedNothing });
    else if (matches(SHORTCUTS.captureAsNote, e) && r.credentials.length) set({ asNote: !pd.asNote });
    else if (matches(SHORTCUTS.captureSave, e)) void save();
    else return;
    e.preventDefault();
  }

  /** A pasted or dropped image: a flag keeps it as its thumbnail, anything else becomes a screenshot. */
  function takeImage(file: File) {
    const keep = kind === "flag" ? ("flag" as const) : null;
    readImage(file).then(
      (image) => {
        releaseImage(useLogEntryStore.getState().drafts[id]?.image);
        // The caption is the next thing to type, once this is a screenshot.
        focusCaption.current = keep === null;
        set({ image, kind: keep });
      },
      (err: Error) => setError(err.message),
    );
  }

  function onPaste(e: ClipboardEvent<HTMLElement>) {
    const file = clipboardImage(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    takeImage(file);
  }

  /** A dragged image file lands where a pasted one would; dragged text drops as the browser drops it. */
  function onDragOver(e: DragEvent<HTMLElement>) {
    if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    const file = clipboardImage(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    takeImage(file);
  }

  function removeImage() {
    releaseImage(pd.image);
    set({ image: null });
    pasteRef.current?.focus();
  }

  function discard() {
    useLogEntryStore.getState().discard(id);
    useLogEntryStore.getState().setNotice(null);
    setError(null);
    onDiscarded();
  }

  const ranOnOptions = Array.from(new Set([...machines, ...hosts.map((h) => h.name), r.edits.ranOn].filter(Boolean)));
  const bindPaste = (el: HTMLElement | null) => {
    pasteRef.current = el;
  };

  return {
    pd, r, kind, hosts, hostsQ, notice, error, saving, msfWarning, ranOnOptions, captionRef,
    set, save, discard, enterSaves, noteEnter, onKeyDown, onPaste, onDragOver, onDrop, removeImage, bindPaste,
  };
}

export type LogEntryFormState = ReturnType<typeof useLogEntryForm>;
