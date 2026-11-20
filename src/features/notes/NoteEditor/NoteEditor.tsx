import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { openThreads, toggleThreadPrefix } from "../../../engines/notes/threads";
import { cx } from "../../../lib/cx";
import { RavenError } from "../../../types/errors";
import { ErrorState, Textarea, Toggle } from "../../../ui/index";
import { CloseThreadDialog, type ClosingThread } from "../CloseThreadDialog/CloseThreadDialog";
import { ThreadsList } from "../ThreadsList/ThreadsList";
import { useNote, useRuledOut } from "../queries";
import { RuledOutList } from "../RuledOutList/RuledOutList";
import { flushQuietly, noteKey, useNotesStore, type NoteTarget } from "../useNotesStore";
import "./NoteEditor.scss";

/**
 * Raw Markdown, typed fast: no macOS text services in WKWebView (autocapitalised lines, inline writing
 * suggestions that Return or "-" interact with, substitutions). `writingsuggestions` (Safari 18+) has no React type.
 */
const NO_TEXT_SERVICES = {
  spellCheck: false,
  autoCorrect: "off",
  autoCapitalize: "off",
  autoComplete: "off",
  writingsuggestions: "false",
} as const;

/**
 * ⌘/ on any layout: the character "/" (some layouts need Shift for it), or the physical key where US
 * keyboards have "/" (Canadian CSA types "é" there). Shift on that physical key is ⌘?, left to macOS Help.
 */
function isSlashChord(e: KeyboardEvent): boolean {
  if (e.key === "/") return true;
  return e.code === "Slash" && !e.shiftKey;
}

/**
 * One note's text: open threads, the textarea (autosaved through the notes store, so text is never dropped),
 * ⌘/ to toggle a thread on the caret line, and the Private toggle. Used by the notes panel and the finding split.
 */
export function NoteEditor({ target, textRef, className }: {
  target: NoteTarget;
  textRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  const key = noteKey(target);
  const note = useNote(target.engagementId, target.hostId);
  const ruledOutQ = useRuledOut(target.engagementId);
  const ruledOut = useMemo(() => (ruledOutQ.data ?? []).filter((r) => r.hostId === target.hostId), [ruledOutQ.data, target.hostId]);
  const pending = useNotesStore((s) => s.pending[key]);
  const error = useNotesStore((s) => s.errors[key]);
  const edit = useNotesStore((s) => s.edit);
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = textRef ?? ownRef;
  // Another note, or the editor going away: what's pending saves now rather than on the autosave timer.
  useEffect(() => () => flushQuietly(), [key]);

  const body = pending?.body ?? note.data?.body ?? "";
  const isPrivate = pending?.private ?? note.data?.private ?? false;
  const privateRef = useRef(isPrivate);
  useEffect(() => {
    privateRef.current = isPrivate;
  });
  const [closing, setClosing] = useState<ClosingThread | null>(null);
  const ready = note.data !== undefined || pending !== undefined;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || !isSlashChord(e)) return;
    const ta = e.currentTarget;
    if (ta.readOnly) return;
    e.preventDefault();
    const text = ta.value;
    const line = text.slice(0, ta.selectionStart).split("\n").length - 1;
    const next = toggleThreadPrefix(text, line);
    const delta = next.length - text.length;
    const lineStart = text.split("\n").slice(0, line).reduce((n, l) => n + l.length + 1, 0);
    const caret = Math.max(lineStart, ta.selectionStart + delta);
    edit(target, next, privateRef.current);
    // Set the DOM value too so the caret survives the controlled re-render (same value, no reset).
    ta.value = next;
    ta.setSelectionRange(caret, caret);
  };

  return (
    <div
      className={cx(
        "note-editor",
        // Threads and ruled-out items (when any), the text, then the footer: the text takes the slack.
        (openThreads(body).length > 0 || ruledOut.length > 0) && "note-editor--lists",
        className,
      )}
    >
      {(openThreads(body).length > 0 || ruledOut.length > 0) && (
        <div className="note-editor__lists">
          <ThreadsList body={body} onClose={(line, text) => setClosing({ line, text })} />
          <RuledOutList engagementId={target.engagementId} items={ruledOut} />
        </div>
      )}
      <Textarea
        ref={ref}
        mono
        aria-label="Notes"
        placeholder="Raw Markdown. Start a line with ? to open a thread."
        value={body}
        readOnly={!ready}
        {...NO_TEXT_SERVICES}
        onChange={(e) => edit(target, e.target.value, isPrivate)}
        onKeyDown={onKeyDown}
        className="note-editor__text"
      />
      <div className="note-editor__footer">
        {note.isError && !pending && (
          <ErrorState
            title="Couldn't load these notes"
            hint="Retry. If it keeps failing, lock and unlock Raven."
            onRetry={() => void note.refetch()}
            detail={RavenError.from(note.error).message}
          />
        )}
        {error && (
          <p role="alert" className="note-editor__error">
            {error}. Your text is still here; it saves again when you type or close.
          </p>
        )}
        <div className="note-editor__status-row">
          <Toggle on={isPrivate} onChange={(on) => edit(target, body, on)} disabled={!ready}>
            Private
          </Toggle>
          <span className="note-editor__status" aria-live="polite">
            {error ? "" : pending ? "Saving…" : note.data && note.data.updatedAt > 0 ? "Saved" : ""}
          </span>
        </div>
      </div>
      <CloseThreadDialog
        thread={closing}
        target={target}
        saved={{ body: note.data?.body ?? "", private: note.data?.private ?? false }}
        onClose={() => setClosing(null)}
      />
    </div>
  );
}
