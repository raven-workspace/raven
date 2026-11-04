import { useState } from "react";
import { closeThread, openThreads } from "../../engines/notes/threads";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import { RavenError } from "../../types/errors";
import { Button, Dialog, Field, Input, Toggle } from "../../ui";
import { flushNotes, noteKey, sessionGeneration, useNotesStore, type NoteTarget } from "./useNotesStore";

export interface ClosingThread {
  line: number;
  text: string;
}

/**
 * Closing a thread: "Panned out", or "Dead end" with a required reason (which becomes a
 * ruled-out item). The line is rewritten through the notes store like typed text, and the
 * ruled-out item is created only after that save succeeded.
 */
export function CloseThreadDialog({
  thread,
  target,
  saved,
  onClose,
}: {
  thread: ClosingThread | null;
  target: NoteTarget;
  /** The note as shown in the panel when no unsaved text exists. */
  saved: { body: string; private: boolean };
  onClose: () => void;
}) {
  return (
    <Dialog open={thread !== null} onOpenChange={(o) => !o && onClose()} title="Close thread" description={thread?.text}>
      {thread && <Body key={`${thread.line}:${thread.text}`} thread={thread} target={target} saved={saved} onClose={onClose} />}
    </Dialog>
  );
}

function Body({ thread, target, saved, onClose }: { thread: ClosingThread; target: NoteTarget; saved: { body: string; private: boolean }; onClose: () => void }) {
  const [outcome, setOutcome] = useState<"panned" | "dead">("panned");
  const [reason, setReason] = useState("");
  const [isPrivate, setIsPrivate] = useState(useNotesStore.getState().pending[noteKey(target)]?.private ?? saved.private);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Set once the closed line is in the pending text (before its save), so a retry skips the rewrite: it re-flushes,
  // then repeats the ruled-out create.
  const [rewritten, setRewritten] = useState(false);
  const needsReason = outcome === "dead";
  const valid = !needsReason || reason.trim() !== "";

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(undefined);
    const gen = sessionGeneration();
    try {
      if (!rewritten) {
        const key = noteKey(target);
        const st = useNotesStore.getState();
        const cached = st.pending[key];
        const base = cached?.body ?? saved.body;
        const priv = cached?.private ?? saved.private;
        if (!openThreads(base).some((t) => t.line === thread.line && t.text === thread.text)) {
          setError("That line changed. Close this dialog and try again.");
          return;
        }
        useNotesStore.getState().edit(target, closeThread(base, thread.line, outcome), priv);
        // The pending body now holds the closed line: from here a retry only re-flushes.
        setRewritten(true);
      }
      try {
        await flushNotes();
      } catch (e) {
        setError(`Couldn't save the note: ${RavenError.from(e).message}. Your reason is kept; try again.`);
        return;
      }
      if (gen !== sessionGeneration()) return; // locked meanwhile: nothing more is written
      if (outcome === "dead") {
        try {
          await api.ruledOutCreate({
            engagementId: target.engagementId,
            hostId: target.hostId,
            text: thread.text,
            reason: reason.trim(),
            private: isPrivate,
          });
        } catch (e) {
          setError(`The line is already marked ✗ in your notes, but the ruled-out item wasn't created: ${RavenError.from(e).message}`);
          return;
        }
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div role="group" aria-label="Outcome" className="flex">
        <Choice on={outcome === "panned"} disabled={rewritten} onClick={() => setOutcome("panned")}>
          Panned out
        </Choice>
        <Choice on={outcome === "dead"} disabled={rewritten} onClick={() => setOutcome("dead")}>
          Dead end
        </Choice>
      </div>
      {needsReason && (
        <>
          <Field label="Reason" hint="One line: why it's ruled out.">
            <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Toggle on={isPrivate} onChange={setIsPrivate} className="self-start">
            Private
          </Toggle>
        </>
      )}
      {error && (
        <p role="alert" className="m-0 text-xs text-warn">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!valid || busy}>
          Close thread
        </Button>
      </div>
    </form>
  );
}

function Choice({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "h-8 border border-line-2 px-3 text-[13px] first:rounded-l-sm last:rounded-r-sm last:border-l-0 cursor-default disabled:opacity-40",
        on ? "border-accent text-accent" : "text-fg-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
