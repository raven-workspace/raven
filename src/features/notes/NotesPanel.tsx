import { useEffect, useRef, useState, type MouseEvent } from "react";
import { toggleThreadPrefix } from "../../engines/notes/threads";
import { isDialogOpen } from "../../lib/keys";
import { RavenError } from "../../types/errors";
import type { Engagement } from "../../types/engagement";
import { Kbd, labelClass, Textarea, Toggle } from "../../ui";
import { cx } from "../../lib/cx";
import { useHosts } from "../hosts/queries";
import { CloseThreadDialog, type ClosingThread } from "./CloseThreadDialog";
import { ThreadsList } from "./ThreadsList";
import { useNote } from "./queries";
import { flushQuietly, MIN_WIDTH, maxWidth, noteKey, useNotesStore, type NotesScope } from "./useNotesStore";

/**
 * Field notes (`N`): a panel over the right side of the engagement screen holding the current
 * host's notes, or the engagement's. Text autosaves and is never dropped: it lives in the notes
 * store until the backend confirms it, and is flushed on close, scope switch, route change and lock.
 */
export function NotesPanel({ engagement, hostId }: { engagement: Engagement; hostId: string | null }) {
  const open = useNotesStore((s) => s.open);
  const storedScope = useNotesStore((s) => s.scope);
  const width = useNotesStore((s) => s.width);
  const scope: NotesScope = hostId && storedScope === "host" ? "host" : "engagement";
  const target = { engagementId: engagement.id, hostId: scope === "host" ? hostId : null };
  const key = noteKey(target);

  // Route change (other host or scope), closing the screen: save what is pending right away.
  useEffect(() => () => flushQuietly(), [key]);

  // Leaving the engagement closes the panel (its text is flushed by the effect above).
  useEffect(() => () => useNotesStore.setState({ open: false }), []);

  const privateRef = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) {
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
      textRef.current?.focus();
    } else if (returnFocus.current?.isConnected) {
      returnFocus.current.focus();
      returnFocus.current = null;
    }
  }, [open]);

  // Capture phase: Esc and ⌘E reach the panel before the shell's own Esc handler, whatever the load order.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (e) => {
      const { open: isOpen, close, setScope } = useNotesStore.getState();
      if (!isOpen || e.defaultPrevented || isDialogOpen()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && isSlashChord(e)) {
        const ta = textRef.current;
        if (!ta || e.target !== ta || ta.readOnly) return;
        e.preventDefault();
        const text = ta.value;
        const line = text.slice(0, ta.selectionStart).split("\n").length - 1;
        const next = toggleThreadPrefix(text, line);
        const delta = next.length - text.length;
        const lineStart = text.split("\n").slice(0, line).reduce((n, l) => n + l.length + 1, 0);
        const caret = Math.max(lineStart, ta.selectionStart + delta);
        useNotesStore.getState().edit(target, next, privateRef.current);
        // Set the DOM value too so the caret survives the controlled re-render (same value, no reset).
        ta.value = next;
        ta.setSelectionRange(caret, caret);
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "e" && hostId) {
        e.preventDefault();
        setScope(scope === "host" ? "engagement" : "host");
      }
    };
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, []);

  if (!open) return null;
  return <PanelBody engagement={engagement} hostId={hostId} scope={scope} width={width} textRef={textRef} privateRef={privateRef} />;
}

function PanelBody({
  engagement,
  hostId,
  scope,
  width,
  textRef,
  privateRef,
}: {
  engagement: Engagement;
  hostId: string | null;
  scope: NotesScope;
  width: number;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
  privateRef: React.RefObject<boolean>;
}) {
  const hosts = useHosts(engagement.id);
  const hostName = hosts.data?.find((h) => h.id === hostId)?.name;
  const target = { engagementId: engagement.id, hostId: scope === "host" ? hostId : null };
  const key = noteKey(target);
  const note = useNote(target.engagementId, target.hostId);
  const pending = useNotesStore((s) => s.pending[key]);
  const error = useNotesStore((s) => s.errors[key]);
  const edit = useNotesStore((s) => s.edit);
  const setScope = useNotesStore((s) => s.setScope);

  const body = pending?.body ?? note.data?.body ?? "";
  const isPrivate = pending?.private ?? note.data?.private ?? false;
  useEffect(() => {
    privateRef.current = isPrivate;
  });
  const [closing, setClosing] = useState<ClosingThread | null>(null);
  const ready = note.data !== undefined || pending !== undefined;
  const scopeName = scope === "host" ? hostName : engagement.name;
  const title = scopeName ? `Notes · ${scopeName}` : "Notes";

  const startDrag = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const { setWidth } = useNotesStore.getState();
    const onMove = (ev: globalThis.MouseEvent) => setWidth(startWidth + (startX - ev.clientX), false);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setWidth(useNotesStore.getState().width, true);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <aside
      aria-label={title}
      style={{ width }}
      className="fixed inset-y-0 right-0 z-30 flex max-w-[70vw] flex-col border-l border-line-2 bg-surface text-fg-2"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize notes"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth()}
        aria-valuenow={width}
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          useNotesStore.getState().setWidth(width + (e.key === "ArrowLeft" ? 24 : -24));
        }}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize hover:bg-line-2 focus-visible:bg-line-2"
      />
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className={cx(labelClass, "m-0 truncate")}>{title}</h2>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Scope" className="flex">
            <Segment on={scope === "host"} disabled={!hostId} onClick={() => setScope("host")}>
              Host
            </Segment>
            <Segment on={scope === "engagement"} onClick={() => setScope("engagement")}>
              Engagement
            </Segment>
          </div>
          <Kbd aria-hidden>⌘E</Kbd>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
        <ThreadsList body={body} onClose={(line, text) => setClosing({ line, text })} />
        <Textarea
          ref={textRef}
          mono
          aria-label="Notes"
          placeholder="Raw Markdown. Start a line with ? to open a thread."
          value={body}
          readOnly={!ready}
          onChange={(e) => edit(target, e.target.value, isPrivate)}
          className="min-h-0 flex-1 resize-none"
        />
        {note.isError && !pending && (
          <p role="alert" className="m-0 text-xs text-warn">
            Couldn't load these notes: {RavenError.from(note.error).message}
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-xs text-warn">
            {error}. Your text is still here; it saves again when you type or close.
          </p>
        )}
        <div className="flex items-center justify-between">
          <Toggle on={isPrivate} onChange={(on) => edit(target, body, on)} disabled={!ready}>
            Private
          </Toggle>
          <span className="text-xs text-muted" aria-live="polite">
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
    </aside>
  );
}

function Segment({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "h-6 border border-line-2 px-2 text-xs first:rounded-l-sm last:rounded-r-sm last:border-l-0 cursor-default disabled:opacity-40",
        on ? "border-accent text-accent" : "text-fg-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/**
 * ⌘/ on any layout: the character "/" (some layouts need Shift for it), or the physical key where US
 * keyboards have "/" (Canadian CSA types "é" there). Shift on that physical key is ⌘?, left to macOS Help.
 */
function isSlashChord(e: KeyboardEvent): boolean {
  if (e.key === "/") return true;
  return e.code === "Slash" && !e.shiftKey;
}
