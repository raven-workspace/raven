import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type { ManualNote } from "../../engines/manual";
import { getCards, useLibraryVersion } from "../../engines/library/store";
import { isFreeKey, isTypingTarget, useKeydown } from "../../lib/keys";
import { RavenError } from "../../types/errors";
import { Button, Disclosure, EmptyState, ErrorState, HintLine, labelClass, type Hint } from "../../ui";
import { HostChip, isHostPickKey, type HostChipHandle } from "../arsenal/HostChip";
import { useFillScope, useLastEngagementStore } from "../arsenal/useFillScope";
import { useFillBase } from "../palette/fillData";
import { MANUAL_NOTE_ID, manualKeysBlocked } from "./keys";
import { MANUAL_QUERY } from "./searchPath";
import { jumpBehavior, ManualOutline, useOutlineSpy } from "./ManualOutline";
import { ManualRail } from "./ManualRail";
import { NoteView } from "./NoteView";
import { useManualStore, type ManualPlace } from "./useManualStore";
import { firstNote, useManualNotes, type ManualStatus } from "./useManualNotes";

/** Saving the place waits for the scroll to settle. */
const SAVE_MS = 200;

export const manualPath = (noteId: string) => `/manual/${encodeURIComponent(noteId)}`;

const HINTS: Hint[] = [
  { keys: "/", label: "filter", priority: 1 },
  { keys: "↵", label: "copy command", priority: 2 },
  { keys: "⌘↵", label: "copy and log", priority: 2 },
  { keys: "⌘[", label: "previous note", priority: 2 },
  { keys: "[ ]", label: "section", priority: 3 },
  { keys: "⌥H", label: "host", priority: 4 },
  { keys: "Esc", label: "back", priority: 1 },
];

/** Without notes only Esc applies. */
const HINTS_EMPTY: Hint[] = HINTS.slice(-1);

/** With a match bar: ⌥↓ ⌥↑ step through the matches and the first Esc clears the bar. */
const HINTS_SEARCH: Hint[] = [
  { keys: "⌥↓ ⌥↑", label: "next / previous match", priority: 1 },
  ...HINTS.slice(0, -1),
  { keys: "Esc", label: "clear search", priority: 1 },
];

/** No engagement or no host: ⌘↵ copies but has nowhere to log, worded as the Arsenal drawer words it. */
const noHost = (hints: Hint[]): Hint[] => hints.map((h) => (h.keys === "⌘↵" ? { ...h, label: "log (no host)" } : h));

const EMPTY_TITLE: Record<Exclude<ManualStatus, "loading" | "ready" | "error">, string> = {
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

/**
 * Marks the `at`-th match current (`data-current` on each of its pieces) and returns the match count and its first
 * piece. Matches are counted by their `start` pieces, in document order.
 */
function markCurrent(pane: HTMLElement, at: number): { count: number; el: HTMLElement | null } {
  let n = -1;
  let el: HTMLElement | null = null;
  for (const m of pane.querySelectorAll<HTMLElement>("mark[data-match]")) {
    if (m.dataset.match === "start") n++;
    const on = n === at;
    if (on && !el) el = m;
    if (on) m.setAttribute("data-current", "");
    else m.removeAttribute("data-current");
  }
  return { count: n + 1, el };
}

/** The first match after `anchor`'s element in document order (0 without one, or with none after it). */
function firstAfter(pane: HTMLElement, anchor: string): number {
  const el = anchor ? pane.querySelector(`[id="${CSS.escape(anchor)}"]`) : null;
  if (!el) return 0;
  const starts = [...pane.querySelectorAll("mark[data-match=start]")];
  const i = starts.findIndex((m) => el.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING);
  return Math.max(0, i);
}

/** Focus without scrolling: the scroll is already where it should be. */
const focusQuietly = (el: HTMLElement | null | undefined) => el?.focus({ preventScroll: true });

/**
 * Focuses a jump target so the next Tab continues from it: a heading (or caption) or the block holding a match. An
 * element that can't take focus gets `tabindex="-1"` (never a tab stop of its own).
 */
function focusTarget(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement)) return;
  if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
  focusQuietly(el);
}

/** The note's top-level block (a paragraph, table, list or command) that holds `el`. */
const blockOf = (el: Element | null): Element | null => el?.closest("article > *") ?? null;

function MatchBar({ query, at, count }: { query: string; at: number; count: number }) {
  return (
    <div
      role="status" aria-label="Search in this note"
      className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line px-8 py-2 text-meta"
    >
      <span className="truncate"><span className="text-muted">Search </span><span className="font-mono text-code text-fg">{query}</span></span>
      <span className={count === 0 ? "text-warn" : "text-fg-2"}>{count === 0 ? "No match in this note" : `match ${at + 1} of ${count}`}</span>
    </div>
  );
}

function Reader({ notes, noteId }: { notes: ManualNote[]; noteId: string | undefined }) {
  const navigate = useNavigate();
  const location = useLocation();
  const note = noteId ? notes.find((n) => n.id === noteId) : undefined;
  const { engagementId, hostId, pending: scopePending } = useFillScope();
  const base = useFillBase(engagementId, hostId);
  const hostRef = useRef<HostChipHandle>(null);
  const setHostId = (id: string | null) => useLastEngagementStore.setState({ engagementId: engagementId || null, hostId: id });
  useLibraryVersion();
  const cards = getCards();

  const paneRef = useRef<HTMLElement>(null);
  // The match bar: `?q=` marks every match in the note; the current one starts in the hash's section.
  const [params] = useSearchParams();
  const query = params.get(MANUAL_QUERY)?.trim() ?? "";
  const filterRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  const [outlineOpen, setOutlineOpen] = useState(false);
  /** The note on screen and its live scroll offset. */
  const shown = useRef<ManualPlace | null>(null);
  /** The scroll the next note opens at (the remembered place, or a ⌘[ return); set just before navigating. */
  const pendingScroll = useRef<ManualPlace | null>(null);
  /** ⌘[ is returning: the note being left is not pushed onto the history. */
  const returning = useRef(false);
  /** A restored scroll waiting for late layout (exam lines, filled text) to settle: applied once more then. */
  const restored = useRef<ManualPlace | null>(null);
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
    restored.current = null;
    if (pending?.noteId === note.id) {
      top = pending.scrollTop;
      if (top > 0 && !base.examReady) restored.current = pending;
    }
    else if (location.hash) {
      const el = pane.querySelector(`[id="${CSS.escape(decodeURIComponent(location.hash.slice(1)))}"]`);
      if (el) {
        el.scrollIntoView?.({ block: "start" });
        top = pane.scrollTop;
      }
    }
    if (left?.noteId !== note.id || pending || location.hash) pane.scrollTop = top;
    // Arriving (M, the title-bar button, a link, ⌘[, ⌘K) puts focus in the note, so ↓ PgDn Space scroll it; a link to a
    // heading focuses that heading. A note opened from the rail keeps focus in the rail, to keep moving along it.
    const inRail = filterRef.current?.closest("nav")?.contains(document.activeElement) ?? false;
    if (!inRail && (left?.noteId !== note.id || pending || location.hash)) {
      const heading = !pending && location.hash ? pane.querySelector(`[id="${CSS.escape(decodeURIComponent(location.hash.slice(1)))}"]`) : null;
      if (heading) focusTarget(heading);
      else focusQuietly(pane);
    }
    shown.current = { noteId: note.id, scrollTop: pane.scrollTop };
    savePlace();
    // location.key: a link to a heading in the same note scrolls again.
  }, [note?.id, location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exam rules and fill data arrive after the first paint and change the note's height: put the restored spot back once.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const r = restored.current;
    if (!base.examReady || !pane || !r) return;
    restored.current = null;
    if (shown.current?.noteId !== r.noteId) return;
    pane.scrollTop = r.scrollTop;
    shown.current = { noteId: r.noteId, scrollTop: pane.scrollTop };
  }, [base.examReady]);

  const ids = useMemo(() => note?.outline.map((o) => o.id) ?? [], [note]);
  const spy = useOutlineSpy(paneRef, ids);

  const [match, setMatch] = useState({ at: 0, count: 0 });
  const matchAt = useRef(0);
  /** `focus`: the current match's block takes focus (a search landing, ⌥↓ ⌥↑), so the next Tab continues there. */
  const showMatch = (at: number, scroll: boolean, focus = false) => {
    const pane = paneRef.current;
    if (!pane) return;
    matchAt.current = at;
    const { count, el } = markCurrent(pane, at);
    setMatch({ at, count });
    if (scroll) el?.scrollIntoView?.({ block: "center" });
    if (focus && el) focusTarget(blockOf(el));
  };
  // After the hash's scroll above: a search lands on its match, not the section top.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!note || !pane || !query) return;
    const inRail = filterRef.current?.closest("nav")?.contains(document.activeElement) ?? false;
    showMatch(firstAfter(pane, decodeURIComponent(location.hash.slice(1))), true, !inRail);
  }, [note?.id, query, location.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Exam lines and filled text arrive late and move the note: bring the current match back into view once.
  useLayoutEffect(() => {
    if (base.examReady && query) showMatch(matchAt.current, true);
  }, [base.examReady]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fill data and exam lines re-render the note's text: keep the current match marked (and the count right).
  useEffect(() => {
    const pane = paneRef.current;
    if (!note || !pane || !query) return;
    const obs = new MutationObserver(() => {
      const { count } = markCurrent(pane, matchAt.current);
      setMatch((m) => (m.count === count ? m : { at: matchAt.current, count }));
    });
    obs.observe(pane, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [note, query]);

  const onScroll = () => {
    const pane = paneRef.current;
    if (!pane || !shown.current) return;
    shown.current = { noteId: shown.current.noteId, scrollTop: pane.scrollTop };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(savePlace, SAVE_MS);
  };

  /**
   * [ ] jump at once; an outline pick glides (instant under reduced motion). No navigation: the address and the
   * history stay as they are, so Esc still leaves the Manual in one press.
   */
  const goSection = (i: number, behavior?: ScrollBehavior) => {
    // The next Tab continues from the section, and ↓ PgDn Space scroll the note.
    focusTarget(spy.jump(i, behavior));
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
    if (query && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.code === "ArrowDown" || e.code === "ArrowUp")) {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (match.count === 0) return;
      showMatch((match.at + (e.code === "ArrowDown" ? 1 : -1) + match.count) % match.count, true, true);
      return;
    }
    if (engagementId && isHostPickKey(e) && !isTypingTarget(e.target)) {
      e.preventDefault();
      hostRef.current?.open();
      return;
    }
    if (!isFreeKey(e)) return;
    if (e.key === "/") {
      e.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
    } else if (e.key === "]" || e.key === "[") {
      e.preventDefault();
      if (ids.length > 0) goSection(spy.step(e.key === "]" ? 1 : -1));
    }
  });

  const pick = (i: number) => goSection(i, jumpBehavior());

  return (
    <div className="grid min-h-0 grid-cols-[260px_minmax(0,1fr)] min-[1100px]:grid-cols-[260px_minmax(0,1fr)_220px]">
      <ManualRail notes={notes} currentId={note?.id ?? null} filter={filter} onFilter={setFilter} filterRef={filterRef} onOpen={open} />
      <div className={`grid min-h-0 ${query ? "grid-rows-[auto_auto_minmax(0,1fr)]" : "grid-rows-[auto_minmax(0,1fr)]"}`}>
        {/* What the note's commands fill for, and where ⌘↵ logs: kept above the scroll so it never moves. */}
        <div className="grid min-h-12 grid-cols-[minmax(10rem,max-content)_minmax(0,1fr)] items-center gap-3 border-b border-line px-8 py-2 text-meta">
          {engagementId ? (
            <>
              <div data-host-chip-cell="" className="grid">
                <HostChip ref={hostRef} hosts={base.d.hosts} value={base.host?.id ?? null} onChange={setHostId} align="start" className="max-w-80" />
              </div>
              <span data-testid="manual-host-ip" className="truncate font-mono text-code text-muted">{base.host?.ip ?? ""}</span>
            </>
          ) : (
            !scopePending && <span className="col-span-2 text-muted">No active engagement</span>
          )}
        </div>
        {query && note && <MatchBar query={query} at={match.at} count={match.count} />}
        <section
          id={MANUAL_NOTE_ID} ref={paneRef} aria-label="Note" tabIndex={-1} onScroll={onScroll}
          className="grid min-h-0 content-start gap-4 overflow-y-auto overflow-x-hidden px-8 py-4 outline-none [--pane-bg:var(--bg)] focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
        >
          {note && (
            <>
              {note.outline.length > 0 && (
                <div className="min-[1100px]:hidden">
                  <Disclosure label="On this page" count={note.outline.length} open={outlineOpen} onOpenChange={setOutlineOpen}>
                    <nav aria-label="On this page" className="grid pt-2">
                      <ManualOutline outline={note.outline} current={spy.current} onPick={pick} />
                    </nav>
                  </Disclosure>
                </div>
              )}
              <div onClickCapture={onClickCapture} className="grid min-w-0">
                <NoteView key={note.id} note={note} notes={notes} cards={cards} hostId={hostId} engagementId={engagementId} query={query} />
              </div>
            </>
          )}
        </section>
      </div>
      <aside aria-label="Outline" className="hidden min-h-0 content-start gap-2 overflow-y-auto overflow-x-hidden border-l border-line px-3 py-4 min-[1100px]:grid">
        <h2 className={`${labelClass} m-0 px-3`}>On this page</h2>
        {note && (
          <nav aria-label="On this page" className="grid">
            <ManualOutline outline={note.outline} current={spy.current} onPick={pick} follow />
          </nav>
        )}
      </aside>
    </div>
  );
}

/**
 * `/manual` and `/manual/:noteId`: the Field Manual's Tools, Foundations and Reporting notes as a reader. The rail and
 * the outline stay put; only the note scrolls. Opens at the remembered place; Esc leaves to where the owner came from.
 */
export function ManualPage() {
  const { notes, status, error, retry } = useManualNotes();
  const { noteId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Fixed at entry: moves inside the Manual replace its one history entry, so going back always leaves it.
  const [firstEntry] = useState(() => location.key === "default");
  const [params] = useSearchParams();
  const searching = !!params.get(MANUAL_QUERY)?.trim();
  const scope = useFillScope();
  const { host } = useFillBase(scope.engagementId, scope.hostId);

  useKeydown((e) => {
    if (e.key !== "Escape" || e.defaultPrevented || manualKeysBlocked()) return;
    if (isTypingTarget(e.target)) {
      (e.target as HTMLElement).blur();
      return;
    }
    e.preventDefault();
    // The first Esc clears the match bar (the note stays where it is), the next leaves.
    if (searching) void navigate({ pathname: location.pathname }, { replace: true });
    else void (firstEntry ? navigate("/") : navigate(-1));
  });

  const pageHints = searching ? HINTS_SEARCH : HINTS;
  const hints = status !== "ready" ? HINTS_EMPTY : scope.engagementId && host ? pageHints : noHost(pageHints);

  let body = null;
  if (status === "ready") body = <Reader notes={notes} noteId={noteId} />;
  else if (status === "error") {
    body = (
      <div className="grid content-start px-6 py-6">
        <ErrorState
          title="Couldn't load the Manual"
          hint="Retry. If it keeps failing, import the Field Manual again from Settings."
          onRetry={retry}
          detail={RavenError.from(error).message}
        />
      </div>
    );
  } else if (status !== "loading") body = <ManualEmpty status={status} />;
  return (
    <main aria-label="Manual" data-hint-surface="" className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      {body ?? <div />}
      <footer className="grid border-t border-line px-6 py-2">
        <HintLine hints={hints} ariaLabel="Manual shortcuts" />
      </footer>
    </main>
  );
}
