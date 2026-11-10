import { useEffect, useRef, type MouseEvent } from "react";
import { isDialogOpen } from "../../lib/keys";
import type { Engagement } from "../../types/engagement";
import { BELOW_TITLE_BAR, Kbd, Toolbar, labelClass } from "../../ui";
import { cx } from "../../lib/cx";
import { useHosts } from "../hosts/queries";
import { NoteEditor } from "./NoteEditor";
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
  return <PanelBody engagement={engagement} hostId={hostId} scope={scope} width={width} textRef={textRef} />;
}

function PanelBody({
  engagement,
  hostId,
  scope,
  width,
  textRef,
}: {
  engagement: Engagement;
  hostId: string | null;
  scope: NotesScope;
  width: number;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const hosts = useHosts(engagement.id);
  const hostName = hosts.data?.find((h) => h.id === hostId)?.name;
  const target = { engagementId: engagement.id, hostId: scope === "host" ? hostId : null };
  const setScope = useNotesStore((s) => s.setScope);
  const scopeName = scope === "host" ? hostName : engagement.name;
  const title = scopeName ? `Notes: ${scopeName}` : "Notes";

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
      className={`fixed ${BELOW_TITLE_BAR} right-0 z-30 grid max-w-[70vw] grid-rows-[auto_minmax(0,1fr)] border-l border-line-2 bg-surface text-fg-2`}
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
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-3">
        {/* The space keeps "Notes SRV11" readable as one heading name; the grid ignores it. */}
        <h2 className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
          <span className={labelClass}>Notes</span>{" "}
          {scopeName && <span className="truncate text-body text-fg" title={scopeName}>{scopeName}</span>}
        </h2>
        <Toolbar>
          <div role="group" aria-label="Scope" className="grid grid-flow-col">
            <Segment on={scope === "host"} disabled={!hostId} onClick={() => setScope("host")}>
              Host
            </Segment>
            <Segment on={scope === "engagement"} onClick={() => setScope("engagement")}>
              Engagement
            </Segment>
          </div>
          <Kbd aria-hidden>⌘E</Kbd>
        </Toolbar>
      </header>
      <NoteEditor target={target} textRef={textRef} className="px-4 py-3" />
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
        "h-7 border border-line-2 px-2 text-body first:rounded-l-sm last:rounded-r-sm last:border-l-0 cursor-default disabled:opacity-40",
        on ? "border-accent text-accent" : "text-fg-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
