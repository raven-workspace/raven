import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import type { ManualNote } from "../../engines/manual";
import { getCards, useLibraryVersion } from "../../engines/library/store";
import { isDialogOpen, isFreeKey, isTypingTarget, useKeydown } from "../../lib/keys";
import { Button, Disclosure, EmptyState, HintLine, labelClass, type Hint } from "../../ui";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useFillScope } from "../arsenal/useFillScope";
import { useNotesStore } from "../notes/useNotesStore";
import { usePayloadsStore } from "../payloads/usePayloadsStore";
import { ManualOutline } from "./ManualOutline";
import { ManualRail } from "./ManualRail";
import { NoteView } from "./NoteView";
import { useManualStore, type ManualPlace } from "./useManualStore";
import { firstNote, useManualNotes, type ManualStatus } from "./useManualNotes";

/** The note pane's id: `M` on the Manual focuses it. */
export const MANUAL_NOTE_ID = "manual-note";
/** How far below the pane's top a heading may sit and still be the current section. */
const CURRENT_SLACK = 24;
/** Saving the place waits for the scroll to settle. */
const SAVE_MS = 200;

/** An Arsenal, Payloads or Notes drawer (or a dialog) is over the page: the page's keys stand aside. */
export const manualKeysBlocked = () =>
  isDialogOpen() || useArsenalStore.getState().open || usePayloadsStore.getState().open || useNotesStore.getState().open;

export const manualPath = (noteId: string) => `/manual/${encodeURIComponent(noteId)}`;

const HINTS: Hint[] = [
  { keys: "/", label: "filter", priority: 1 },
  { keys: "[ ]", label: "section", priority: 2 },
  { keys: "⌘[", label: "previous note", priority: 2 },
  { keys: "↵", label: "copy command", priority: 3 },
  { keys: "Esc", label: "back", priority: 1 },
];

/** Without notes only Esc applies. */
const HINTS_EMPTY: Hint[] = HINTS.slice(-1);

const EMPTY_TITLE: Record<Exclude<ManualStatus, "loading" | "ready">, string> = {
  "never-imported": "Import your Field Manual to fill the Manual",
  "old-import": "Your last import is from before the Manual: import again to bring the notes in",
  empty: "Your last import found no Tools, Foundations or Reporting notes",
};

function ManualEmpty({ status }: { status: keyof typeof EMPTY_TITLE }) {
  const navigate = useNavigate();
  return (
    <div className="grid content-start px-6 py-6">
      <EmptyState
        title={EMPTY_TITLE[status]}
        body="The Manual holds your Field Manual's Tools, Foundations and Reporting notes."
        action={<Button onClick={() => void navigate("/settings#field-manual")}>Open Field Manual settings</Button>}
      />
    </div>
  );
}

/** The geometry read of the current section: the last entry whose element is at or above the pane's top. */
function sectionAt(pane: HTMLElement, ids: string[]): number {
  const top = pane.getBoundingClientRect().top;
  let at = -1;
  ids.forEach((id, i) => {
    const el = pane.querySelector(`[id="${CSS.escape(id)}"]`);
    if (el && el.getBoundingClientRect().top - top <= CURRENT_SLACK) at = i;
  });
  return at;
}

function Reader({ notes, noteId }: { notes: ManualNote[]; noteId: string | undefined }) {
  const navigate = useNavigate();
  const location = useLocation();
  const note = noteId ? notes.find((n) => n.id === noteId) : undefined;
  const { engagementId, hostId } = useFillScope();
  useLibraryVersion();
  const cards = getCards();

  const paneRef = useRef<HTMLElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  const [current, setCurrent] = useState(-1);
  const [outlineOpen, setOutlineOpen] = useState(false);
  /** The note on screen and its live scroll offset. */
  const shown = useRef<ManualPlace | null>(null);
  /** The scroll the next note opens at (the remembered place, or a ⌘[ return); set just before navigating. */
  const pendingScroll = useRef<ManualPlace | null>(null);
  /** ⌘[ is returning: the note being left is not pushed onto the history. */
  const returning = useRef(false);
  /** The last section reached by [ ] or the outline: near the end of a note the pane can't scroll it to the top. */
  const jumped = useRef(-1);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const savePlace = () => {
    clearTimeout(saveTimer.current);
    if (shown.current) useManualStore.getState().setPlace(shown.current);
  };
  useEffect(() => () => savePlace(), []);

  // `/manual` (or a note that no longer exists): open the remembered place, else the first Foundations note.
  useEffect(() => {
    if (note) return;
    const place = useManualStore.getState().place;
    const remembered = !noteId && place && notes.some((n) => n.id === place.noteId) ? place : null;
    const target = remembered?.noteId ?? firstNote(notes)?.id;
    if (!target) return;
    pendingScroll.current = remembered ?? { noteId: target, scrollTop: 0 };
    void navigate(manualPath(target), { replace: true });
  }, [note, noteId, notes, navigate]);

  // A note opens: push the one left behind (unless ⌘[ is returning to it), then restore or reset the scroll.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!note || !pane) return;
    const left = shown.current;
    const store = useManualStore.getState();
    if (left && left.noteId !== note.id && !returning.current) store.push(left);
    returning.current = false;
    let top = 0;
    const pending = pendingScroll.current;
    pendingScroll.current = null;
    if (pending?.noteId === note.id) top = pending.scrollTop;
    else if (location.hash) {
      const el = pane.querySelector(`[id="${CSS.escape(decodeURIComponent(location.hash.slice(1)))}"]`);
      if (el) {
        el.scrollIntoView?.({ block: "start" });
        top = pane.scrollTop;
      }
    }
    if (left?.noteId !== note.id || pending || location.hash) pane.scrollTop = top;
    shown.current = { noteId: note.id, scrollTop: pane.scrollTop };
    if (left?.noteId !== note.id) {
      setCurrent(-1);
      jumped.current = -1;
    }
    savePlace();
    // location.key: a link to a heading in the same note scrolls again.
  }, [note?.id, location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ids = useMemo(() => note?.outline.map((o) => o.id) ?? [], [note]);

  const onScroll = () => {
    const pane = paneRef.current;
    if (!pane || !shown.current) return;
    shown.current = { noteId: shown.current.noteId, scrollTop: pane.scrollTop };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(savePlace, SAVE_MS);
    let at = sectionAt(pane, ids);
    const atEnd = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
    if (atEnd && jumped.current > at) at = jumped.current;
    setCurrent(at);
  };

  const goSection = (i: number) => {
    const id = ids[i];
    const pane = paneRef.current;
    if (id === undefined || !pane) return;
    jumped.current = i;
    setCurrent(i);
    pane.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: "start" });
  };

  const open = (id: string) => {
    if (id !== note?.id) void navigate(manualPath(id), { replace: true });
  };

  // A note link stays in the Manual's one history entry, so Esc always leaves the Manual.
  const onClickCapture = (e: ReactMouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = (e.target as Element).closest("a[href]")?.getAttribute("href");
    if (!href?.startsWith("/manual/")) return;
    e.preventDefault();
    void navigate(href, { replace: true });
  };

  useKeydown((e) => {
    if (e.defaultPrevented || manualKeysBlocked()) return;
    if (e.key === "[" && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      const prev = useManualStore.getState().back();
      if (!prev) return;
      if (!notes.some((n) => n.id === prev.noteId)) return;
      returning.current = true;
      pendingScroll.current = prev;
      void navigate(manualPath(prev.noteId), { replace: true });
      return;
    }
    if (!isFreeKey(e)) return;
    if (e.key === "/") {
      e.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
    } else if (e.key === "]" || e.key === "[") {
      e.preventDefault();
      const next = e.key === "]" ? Math.min(ids.length - 1, current + 1) : Math.max(0, current - 1);
      goSection(next);
    }
  });

  const outline = note ? <ManualOutline outline={note.outline} current={current} onPick={goSection} /> : null;

  return (
    <div className="grid min-h-0 grid-cols-[260px_minmax(0,1fr)] min-[1100px]:grid-cols-[260px_minmax(0,1fr)_220px]">
      <ManualRail notes={notes} currentId={note?.id ?? null} filter={filter} onFilter={setFilter} filterRef={filterRef} onOpen={open} />
      <section
        id={MANUAL_NOTE_ID} ref={paneRef} aria-label="Note" tabIndex={-1} onScroll={onScroll}
        className="grid min-h-0 content-start gap-4 overflow-y-auto overflow-x-hidden px-8 py-4 outline-none [--pane-bg:var(--bg)]"
      >
        {note && (
          <>
            {note.outline.length > 0 && (
              <div className="min-[1100px]:hidden">
                <Disclosure label="On this page" count={note.outline.length} open={outlineOpen} onOpenChange={setOutlineOpen}>
                  <nav aria-label="On this page" className="grid pt-2">{outline}</nav>
                </Disclosure>
              </div>
            )}
            <div onClickCapture={onClickCapture} className="grid min-w-0">
              <NoteView key={note.id} note={note} notes={notes} cards={cards} hostId={hostId} engagementId={engagementId} />
            </div>
          </>
        )}
      </section>
      <aside aria-label="Outline" className="hidden min-h-0 content-start gap-2 overflow-y-auto overflow-x-hidden border-l border-line px-3 py-4 min-[1100px]:grid">
        <h2 className={`${labelClass} m-0 px-2`}>On this page</h2>
        <nav aria-label="On this page" className="grid">{outline}</nav>
      </aside>
    </div>
  );
}

/**
 * `/manual` and `/manual/:noteId`: the Field Manual's Tools, Foundations and Reporting notes as a reader. The rail and
 * the outline stay put; only the note scrolls. Opens at the remembered place; Esc leaves to where the owner came from.
 */
export function ManualPage() {
  const { notes, status } = useManualNotes();
  const { noteId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Fixed at entry: moves inside the Manual replace its one history entry, so going back always leaves it.
  const [firstEntry] = useState(() => location.key === "default");

  useKeydown((e) => {
    if (e.key !== "Escape" || e.defaultPrevented || manualKeysBlocked()) return;
    if (isTypingTarget(e.target)) {
      (e.target as HTMLElement).blur();
      return;
    }
    e.preventDefault();
    void (firstEntry ? navigate("/") : navigate(-1));
  });

  let body = null;
  if (status === "ready") body = <Reader notes={notes} noteId={noteId} />;
  else if (status !== "loading") body = <ManualEmpty status={status} />;
  return (
    <main aria-label="Manual" data-hint-surface="" className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      {body ?? <div />}
      <footer className="grid border-t border-line px-6 py-2">
        <HintLine hints={status === "ready" ? HINTS : HINTS_EMPTY} ariaLabel="Manual shortcuts" />
      </footer>
    </main>
  );
}
