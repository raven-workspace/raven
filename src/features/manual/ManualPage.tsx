import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type { ManualNote } from "../../engines/manual";
import { isInlineCommand, lookupRows, type LookupRow } from "../../engines/manual/lookup";
import { getCards, useLibraryVersion } from "../../engines/library/store";
import { isFreeKey, isTypingTarget, useKeydown } from "../../lib/keys";
import { RavenError } from "../../types/errors";
import { Button, Disclosure, EmptyState, ErrorState, HintLine, labelClass, type Hint } from "../../ui";
import { HostChip, isHostPickKey, type HostChipHandle } from "../arsenal/HostChip";
import { useFillScope, useLastEngagementStore } from "../arsenal/useFillScope";
import { useFillBase } from "../palette/fillData";
import { AnswerCard } from "./AnswerCard";
import { MANUAL_NOTE_ID, manualKeysBlocked } from "./keys";
import { MANUAL_QUERY } from "./searchPath";
import { jumpBehavior, ManualOutline, useOutlineSpy } from "./ManualOutline";
import { ManualRail } from "./ManualRail";
import { NoteView } from "./NoteView";
import { useManualStatus } from "./useManualStatus";
import { useManualStore, type ManualPlace } from "./useManualStore";
import { firstNote, useManualNotes, type ManualStatus } from "./useManualNotes";

/** The "Opening the Manual…" line waits this long, so a quick load shows nothing. */
const LOADING_MS = 300;
/** Saving the place waits for the scroll to settle. */
const SAVE_MS = 200;

export const manualPath = (noteId: string) => `/manual/${encodeURIComponent(noteId)}`;

const HINTS: Hint[] = [
  // The line keeps five (DESIGN.md); the rest wait in the ? list, and "/" and "⌘[" take a slot when copy hints go.
  { keys: "/", label: "filter", priority: 4 },
  { keys: "↵", label: "copy command", priority: 2 },
  { keys: "⌘↵", label: "copy and log", priority: 2 },
  { keys: "⌘[", label: "previous note", priority: 4 },
  { keys: "[ ]", label: "section", priority: 3 },
  { keys: "⌥H", label: "host", priority: 3 },
  { keys: "Esc", label: "back", priority: 1 },
];

/** Only in the `?` list: keys the line has no room for. */
const MORE: Hint[] = [
  { keys: "M", label: "focus the note", priority: 1 },
  { keys: "⌥↓ ⌥↑", label: "next / previous match", priority: 1 },
];

/** The note holds a command: a code block, or an inline code span that reads as one. */
const hasCommands = (note: ManualNote | undefined): boolean =>
  !!note && (/^\s*(```|~~~)/m.test(note.body) || [...note.body.matchAll(/`([^`\n]+)`/g)].some((m) => isInlineCommand(m[1]!)));

/** Hints for copying a command mean nothing on a note without one. */
const withoutCopy = (hints: Hint[]): Hint[] => hints.filter((h) => h.keys !== "↵" && h.keys !== "⌘↵");

/** Without notes only Esc applies. */
const HINTS_EMPTY: Hint[] = HINTS.slice(-1);

/** With a match bar: ⌥↓ ⌥↑ step through the matches and the first Esc clears the bar. */
const HINTS_SEARCH: Hint[] = [
  { keys: "⌥↓ ⌥↑", label: "next / previous match", priority: 1 },
  ...HINTS.slice(0, -1),
  { keys: "Esc", label: "clear search", priority: 1 },
];

/** With an answer card: the first Esc closes the card (the match bar stays). */
const HINTS_CARD: Hint[] = HINTS_SEARCH.map((h) => (h.keys === "Esc" ? { ...h, label: "close card" } : h));

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
  for (const r of pane.querySelectorAll("tr[data-current-row]")) r.removeAttribute("data-current-row");
  for (const m of pane.querySelectorAll<HTMLElement>("mark[data-match]")) {
    if (m.dataset.match === "start") n++;
    const on = n === at;
    if (on && !el) el = m;
    if (on) m.setAttribute("data-current", "");
    else m.removeAttribute("data-current");
  }
  // A match in a table lights its row.
  el?.closest("tr")?.setAttribute("data-current-row", "");
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

/** The reader column's rows: the host row, then the match bar and the answer card when they show, then the note. */
const ROWS = ["grid-rows-[auto_minmax(0,1fr)]", "grid-rows-[auto_auto_minmax(0,1fr)]", "grid-rows-[auto_auto_auto_minmax(0,1fr)]"];

/** The lookup row a match sits in (by its table's anchor and its row), or null in prose or any other table. */
function rowOf(note: ManualNote, el: HTMLElement | null): LookupRow | null {
  const anchor = el?.closest<HTMLElement>("[data-table]")?.dataset.table;
  const at = el?.closest<HTMLElement>("tr[data-row]")?.dataset.row;
  if (!anchor || at === undefined) return null;
  return lookupRows(note).find((r) => r.anchor === anchor && r.row === Number(at)) ?? null;
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

/** The one status line: what the last copy or hold-back said, right-aligned in the host row. Gone when the note changes. */
function StatusSlot() {
  const { text, tone } = useManualStatus();
  return <span role="status" className={`truncate text-right text-meta ${tone === "warn" ? "text-warn" : "text-accent"}`}>{text}</span>;
}

/** What the page's Esc needs of the answer card: close it if one shows (true when it did). */
type CardEsc = RefObject<(() => boolean) | null>;

function Reader({ notes, noteId, cardEscRef, onCard }: {
  notes: ManualNote[]; noteId: string | undefined; cardEscRef: CardEsc; onCard: (shown: boolean) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const note = noteId ? notes.find((n) => n.id === noteId) : undefined;
  const { engagementId, hostId, pending: scopePending } = useFillScope();
  const base = useFillBase(engagementId, hostId);
  const hostRef = useRef<HostChipHandle>(null);
  const setHostId = (id: string | null) => useLastEngagementStore.setState({ engagementId: engagementId || null, hostId: id });
  useLibraryVersion();
  const cards = getCards();
  const noteKey = note?.id;
  useEffect(() => useManualStatus.getState().clear(), [noteKey]);

  const paneRef = useRef<HTMLElement>(null);
  // The match bar: `?q=` marks every match in the note; the current one starts in the hash's section.
  const [params] = useSearchParams();
  const query = params.get(MANUAL_QUERY)?.trim() ?? "";
  const filterRef = useRef<HTMLInputElement>(null);
  /** The pane or anything in it has focus: the host row's hairline shows it. */
  const [paneFocused, setPaneFocused] = useState(false);
  /** The next note opened takes focus even from the rail (↵ in the filter). */
  const readNext = useRef(false);
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
    if ((!inRail || readNext.current) && (left?.noteId !== note.id || pending || location.hash)) {
      const heading = !pending && location.hash ? pane.querySelector(`[id="${CSS.escape(decodeURIComponent(location.hash.slice(1)))}"]`) : null;
      if (heading) focusTarget(heading);
      else focusQuietly(pane);
    }
    readNext.current = false;
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
  const spy = useOutlineSpy(paneRef, note?.id ?? "", ids);

  const [match, setMatch] = useState({ at: 0, count: 0 });
  const matchAt = useRef(0);
  /** The lookup row the current match sits in, and whether Esc closed its card (until the match moves). */
  const [card, setCard] = useState<{ row: LookupRow | null; closed: boolean; land?: boolean }>({ row: null, closed: false });
  const cardRow = query && !card.closed ? card.row : null;
  /** `focus`: the current match's block takes focus (a search landing, ⌥↓ ⌥↑), so the next Tab continues there. */
  /** `land`: a `?q=` landing, whose answer card (if any) then takes focus on its first command. */
  const showMatch = (at: number, scroll: boolean, focus = false, land = false) => {
    const pane = paneRef.current;
    if (!pane) return;
    // A landing or ⌥↓ ⌥↑ (`focus`) shows the card afresh; a quiet re-show of the same match (late fill data) keeps it closed.
    const same = !focus && matchAt.current === at;
    matchAt.current = at;
    const { count, el } = markCurrent(pane, at);
    setMatch({ at, count });
    const row = note ? rowOf(note, el) : null;
    setCard((c) => (same && c.row === row ? c : { row, closed: false, land }));
    if (scroll) el?.scrollIntoView?.({ block: "center" });
    if (focus && el) focusTarget(blockOf(el));
  };
  // After the hash's scroll above: a search lands on its match, not the section top.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!query) pane?.querySelectorAll("tr[data-current-row]").forEach((r) => r.removeAttribute("data-current-row"));
    if (!note || !pane || !query) return;
    const inRail = filterRef.current?.closest("nav")?.contains(document.activeElement) ?? false;
    // A landing whose match gets an answer card with a command puts focus on that command instead (↵ copies it).
    showMatch(firstAfter(pane, decodeURIComponent(location.hash.slice(1))), true, !inRail, !inRail);
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

  const cardBoxRef = useRef<HTMLDivElement>(null);
  // A `?q=` landing's card takes focus on its first command row, if it has one (⌥↓ ⌥↑ leave focus on the note).
  useEffect(() => {
    if (card.land) cardBoxRef.current?.querySelector<HTMLElement>("[data-card-stop][role=group]")?.focus({ preventScroll: true });
  }, [card]);

  const closeCard = () => {
    // Focus in the card would be lost with it: it goes back to the note.
    if (document.activeElement?.closest("[aria-label=Answer]")) focusQuietly(paneRef.current);
    setCard((c) => ({ ...c, closed: true, land: false }));
  };
  const shownCard = !!(cardRow && note);
  useEffect(() => {
    cardEscRef.current = shownCard ? () => (closeCard(), true) : null;
    onCard(shownCard);
  });
  useEffect(() => () => {
    cardEscRef.current = null;
    onCard(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const open = (id: string, read = false) => {
    if (id !== note?.id) {
      readNext.current = read;
      void navigate(manualPath(id), { replace: true });
    } else if (read) focusQuietly(paneRef.current);
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
      if (!prev) {
        useManualStatus.getState().set("No previous note", "ok");
        return;
      }
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
      const to = spy.step(e.key === "]" ? 1 : -1);
      if (to >= 0) goSection(to);
    }
  });

  const pick = (i: number) => goSection(i, jumpBehavior());

  return (
    <div className="grid min-h-0 grid-cols-[clamp(200px,20vw,260px)_minmax(0,1fr)] min-[1100px]:grid-cols-[clamp(200px,20vw,260px)_minmax(0,1fr)_220px]">
      <ManualRail notes={notes} currentId={note?.id ?? null} filter={filter} onFilter={setFilter} filterRef={filterRef} onOpen={open} />
      <div className={`grid min-h-0 ${ROWS[(query && note ? 1 : 0) + (shownCard ? 1 : 0)]}`}>
        {/* What the note's commands fill for, and where ⌘↵ logs: kept above the scroll so it never moves. */}
        <div
          data-host-row="" {...(paneFocused ? { "data-pane-focused": "" } : {})}
          className="grid min-h-12 grid-cols-[minmax(10rem,max-content)_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-8 py-2 text-meta data-[pane-focused]:border-accent"
        >
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
          <StatusSlot />
        </div>
        {query && note && <MatchBar query={query} at={match.at} count={match.count} />}
        {/* The answer card: fixed above the note's scroll (it never moves with the note), its own scroll past 40vh. */}
        {cardRow && note && (
          <div ref={cardBoxRef} className="grid min-w-0 border-b border-line px-8 py-3">
            <AnswerCard key={`${cardRow.anchor}:${cardRow.row}`} row={cardRow} base={base} onClose={closeCard} />
          </div>
        )}
        <section
          id={MANUAL_NOTE_ID} ref={paneRef} aria-label="Note" tabIndex={-1} onScroll={onScroll}
          onFocus={() => setPaneFocused(true)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPaneFocused(false)}
          className="relative grid min-h-0 content-start gap-4 overflow-y-auto overflow-x-hidden px-8 py-4 outline-none [--pane-bg:var(--bg)]"
        >
          {note && (
            <>
              {note.outline.length > 0 && (
                <div className="min-[1100px]:hidden">
                  <Disclosure label="On this page" count={note.outline.length} open={outlineOpen} onOpenChange={setOutlineOpen}>
                    <nav aria-label="On this page" className="grid pt-2">
                      <ManualOutline key={note.id} outline={note.outline} current={spy.current} onPick={pick} />
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
      <aside aria-label="Outline" className="relative hidden min-h-0 content-start overflow-y-auto overflow-x-hidden border-l border-line px-3 pb-4 min-[1100px]:grid">
        {/* Sticky, so the label never scrolls away while the aside follows a long outline. */}
        <h2 data-outline-head="" className={`${labelClass} sticky top-0 z-10 m-0 bg-bg px-3 pt-4 pb-2`}>On this page</h2>
        {note && (
          <nav aria-label="On this page" className="grid">
            <ManualOutline key={note.id} outline={note.outline} current={spy.current} onPick={pick} follow />
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
  const cardEscRef: CardEsc = useRef(null);
  const [cardShown, setCardShown] = useState(false);
  // A load that is still going after 300ms says so; a fast one shows nothing.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (status !== "loading") return;
    const t = setTimeout(() => setSlow(true), LOADING_MS);
    return () => clearTimeout(t);
  }, [status]);

  useKeydown((e) => {
    if (e.key !== "Escape" || e.defaultPrevented || manualKeysBlocked()) return;
    if (isTypingTarget(e.target)) {
      (e.target as HTMLElement).blur();
      return;
    }
    e.preventDefault();
    // An answer card closes first (the match bar stays).
    if (cardEscRef.current?.()) return;
    // The first Esc clears the match bar (the note stays where it is), the next leaves.
    if (searching) void navigate({ pathname: location.pathname }, { replace: true });
    else void (firstEntry ? navigate("/") : navigate(-1));
  });

  const open = noteId ? notes.find((n) => n.id === noteId) : undefined;
  // An answer card has commands of its own, so only the plain variants lose the copy hints.
  const base = searching ? (cardShown ? HINTS_CARD : HINTS_SEARCH) : HINTS;
  const pageHints = cardShown || hasCommands(open) ? base : withoutCopy(base);
  const hints = status !== "ready" ? HINTS_EMPTY : scope.engagementId && host ? pageHints : noHost(pageHints);

  let body = null;
  if (status === "ready") body = <Reader notes={notes} noteId={noteId} cardEscRef={cardEscRef} onCard={setCardShown} />;
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
  else if (slow) body = <p className="m-0 content-start px-8 py-4 text-meta text-muted">Opening the Manual…</p>;
  return (
    <main aria-label="Manual" data-hint-surface="" className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      {body ?? <div />}
      <footer className="grid border-t border-line px-6 py-2">
        <HintLine hints={hints} more={status === "ready" ? MORE.filter((h) => !hints.some((x) => x.keys === h.keys)) : []} ariaLabel="Manual shortcuts" />
      </footer>
    </main>
  );
}
