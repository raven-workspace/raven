import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { filterForKind } from "../../engines/checklist";
import { categoryLabel } from "../../engines/library/categories";
import { getCards, getLibrary, getToolkit, useLibraryVersion } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import { isTypingTarget } from "../../lib/keys";
import { reportError } from "../../lib/lockSignal";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import { Button } from "../../ui";
import { fillLibraryCommand } from "../checklist/goalCommands";
import { CommandList } from "../checklist/CommandList";
import { useFillBase } from "../palette/fillData";
import type { SuggestContext } from "../palette/suggest";
import { shortHostName } from "../../lib/hostName";
import { WikiText } from "./WikiText";
import { FillBar } from "./FillBar";
import { autoFill, tokensOf } from "./fillTokens";

const COPY_BUTTON = 'button[aria-label^="Copy command"]';
const CRED_CHIP = '[aria-label^="Fill with credential"]';
const FILL_VALUES = '[aria-label="Fill values"]';

/**
 * Fill chips plus filled blocks for a list of commands. `engagementId` and `hostId` decide what fills; the exam rules
 * of that engagement hide banned commands. Edits to a chip are `overrides` for every command shown. The credential
 * chip lives in the surface's header: `focusCred` is where the copy guard sends focus when a command needs one.
 *
 * Keys, with focus in the pane: `j`/`k` move between blocks, `c` (or Enter on a block) copies the focused one
 * through the copy guard. `focusBlockId` scrolls to a block and outlines it until the next keypress.
 */
export function CommandPane({ commands, also = [], engagementId, hostId, overrides, onOverrides, focusCred: focusCredChip, focusBlockId = null, contents = false, autoFocus = true, onOpenCard }: {
  commands: LibraryCommand[]; also?: LibraryCommand[]; engagementId: string; hostId: string | null;
  /** Chip edits, owned by the screen so they can be dropped when the host changes. */
  overrides: Record<string, string>; onOverrides: (next: Record<string, string>) => void;
  focusCred?: () => void;
  focusBlockId?: string | null;
  /** Shows the sticky strip of block titles (a card, not one command). */
  contents?: boolean;
  /** Take focus on mount so j/k/c work at once (off where focus belongs to a list beside the pane). */
  autoFocus?: boolean;
  /** Opens a card a `[[link]]` in a note points at; without it, links show as plain text. */
  onOpenCard?: (cardId: string) => void;
}) {
  const { d, host, cred, makeInput, examReady } = useFillBase(engagementId, hostId);
  const kind = d.engagement?.kind;
  const fieldEls = useRef(new Map<string, HTMLInputElement>());
  const root = useRef<HTMLDivElement>(null);
  // The block whose copy was held back (focus went to a fill field or the credential chip): Enter there copies it anyway.
  const waitingBlock = useRef<string | null>(null);
  const focusToken = useCallback((t: string) => fieldEls.current.get(t)?.focus(), []);
  const hostName = host ? shortHostName(host.name) : null;
  const blockEl = (id: string) => document.getElementById(`block-${id}`);

  const visible = (list: LibraryCommand[]) => {
    // Fail closed: nothing until the engagement's exam rules are known.
    if (!examReady) return { shown: [], msfMarker: new Set<string>() };
    if (!kind) return { shown: list, msfMarker: new Set<string>() };
    return filterForKind(list, kind, { hostId: host?.id ?? "", msfHostId: d.engagement?.msfHostId ?? null });
  };
  const main = visible(commands);
  const extra = visible(also);
  const input = useMemo(() => makeInput(overrides), [makeInput, overrides]);
  const templates = [...main.shown, ...extra.shown].map((c) => c.template);
  const tokens = tokensOf(templates);
  const auto = autoFill(tokens, makeInput({}));
  const suggestCtx: SuggestContext = { engagement: d.engagement, hosts: d.hosts, services: d.services, credentials: d.credentials, host, toolkit: getToolkit() };

  // The outline of the block the card opened at, until the next keypress.
  const [seenFocus, setSeenFocus] = useState(focusBlockId);
  const [marked, setMarked] = useState(focusBlockId);
  if (seenFocus !== focusBlockId) {
    setSeenFocus(focusBlockId);
    setMarked(focusBlockId);
  }
  const shownIds = main.shown.map((c) => c.id).join(",");
  const scrolledTo = useRef<string | null>(null);
  const didAutoFocus = useRef(false);
  useEffect(() => {
    // The pane takes focus so j/k/c work at once; a block to open at takes it instead (once its block is on screen).
    if (!focusBlockId) {
      // Once, when the first block shows: later changes (exam rules, a re-import) must not pull focus back from a field.
      if (autoFocus && shownIds !== "" && !didAutoFocus.current) {
        didAutoFocus.current = true;
        root.current?.focus({ preventScroll: true });
      }
      return;
    }
    const el = scrolledTo.current === focusBlockId ? null : blockEl(focusBlockId);
    if (!el) return;
    scrolledTo.current = focusBlockId;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: "start" });
  }, [focusBlockId, shownIds, autoFocus]);

  // The strip highlights the block in view while scrolling.
  const [inView, setInView] = useState<string | null>(null);
  useEffect(() => {
    if (!contents || typeof IntersectionObserver === "undefined") return;
    const ids = shownIds.split(",").filter(Boolean);
    const seen = new Set<string>();
    // Measure against the pane that scrolls (not the window), so a block under the strip counts as out of view.
    let pane: HTMLElement | null = document.getElementById(`block-${ids[0]}`)?.parentElement ?? null;
    while (pane && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.blockId ?? "";
          if (e.isIntersecting) seen.add(id);
          else seen.delete(id);
        }
        setInView((prev) => ids.find((id) => seen.has(id)) ?? prev);
      },
      { root: pane, rootMargin: "-40px 0px -60% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(`block-${id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [contents, shownIds]);

  // A held-back copy that sent focus to the credential chip: a second Enter or c on the chip copies anyway.
  // (A fill field is handled in `onKeyDown`, after its suggestion list has had the key.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = waitingBlock.current;
      if (!id || (e.key !== "Enter" && e.key !== "c") || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (!(e.target instanceof HTMLElement && e.target.closest(CRED_CHIP))) return;
      e.preventDefault();
      e.stopPropagation();
      waitingBlock.current = null;
      blockEl(id)?.querySelector<HTMLElement>(COPY_BUTTON)?.click();
    };
    const onFocus = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement && e.target.closest(`${CRED_CHIP},${FILL_VALUES}`))) waitingBlock.current = null;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("focusin", onFocus);
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    setMarked(null);
    // Enter in a fill field the copy guard sent focus to: copy that block anyway (a picked suggestion kept the key).
    const waiting = waitingBlock.current;
    if (waiting && e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.nativeEvent.isComposing && !e.defaultPrevented
      && e.target instanceof HTMLElement && e.target.closest(FILL_VALUES)) {
      e.preventDefault();
      waitingBlock.current = null;
      blockEl(waiting)?.querySelector<HTMLElement>(COPY_BUTTON)?.click();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing || e.defaultPrevented || isTypingTarget(e.target)) return;
    const cur = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("[data-block]") : null;
    if (e.key === "j" || e.key === "k") {
      // Blocks inside the folded "Also in Raven" are not reachable.
      const blocks = [...(root.current?.querySelectorAll<HTMLElement>("[data-block]") ?? [])].filter((b) => !b.closest("details:not([open])"));
      const at = cur ? blocks.indexOf(cur) : -1;
      const next = blocks[e.key === "j" ? Math.min(blocks.length - 1, at + 1) : Math.max(0, at - 1)];
      if (!next) return;
      e.preventDefault();
      next.focus({ preventScroll: true });
      next.scrollIntoView?.({ block: "nearest" });
    } else if (cur && (e.key === "c" || (e.key === "Enter" && e.target === cur))) {
      e.preventDefault();
      cur.querySelector<HTMLElement>(COPY_BUTTON)?.click();
    }
  };

  // Keep the current entry visible in a strip that scrolls sideways.
  const stripRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = stripRow.current;
    const el = inView ? row?.querySelector<HTMLElement>(`[data-for="${inView}"]`) : null;
    if (!row || !el) return;
    if (el.offsetLeft < row.scrollLeft || el.offsetLeft + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = el.offsetLeft - 8;
  }, [inView]);

  // The strip hides its scrollbar (an overlay one sat over the labels); a faded edge says there is more that way.
  const [edges, setEdges] = useState({ start: false, end: false });
  const measureStrip = useCallback(() => {
    const r = stripRow.current;
    if (!r) return;
    const start = r.scrollLeft > 1;
    const end = r.scrollLeft + r.clientWidth < r.scrollWidth - 1;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);
  const hasStrip = !!contents && main.shown.length > 1;
  useEffect(() => {
    const r = stripRow.current;
    if (!hasStrip || !r) return;
    measureStrip();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measureStrip);
    ro.observe(r);
    return () => ro.disconnect();
  }, [hasStrip, measureStrip]);
  const fade = edges.start || edges.end
    ? `linear-gradient(to right, ${edges.start ? "transparent 0, #000 32px" : "#000 0"}, ${edges.end ? "#000 calc(100% - 32px), transparent 100%" : "#000 100%"})`
    : undefined;

  const jump = (id: string) => {
    setInView(id);
    const el = blockEl(id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };

  const block = (c: LibraryCommand, msf: Set<string>) => (
    <div
      key={c.id} id={`block-${c.id}`} data-block="" data-block-id={c.id} tabIndex={-1}
      className={cx("-m-1.5 grid scroll-mt-14 gap-1 rounded-sm p-1.5 outline-none focus:ring-1 focus:ring-accent", marked === c.id && "ring-1 ring-accent")}
    >
      <CommandList
        commands={[fillLibraryCommand(c, input, msf.has(c.id))]} hostName={hostName} hideDcNote strongTitles
        focusToken={(t) => {
          waitingBlock.current = c.id;
          focusToken(t);
        }}
        focusCred={() => {
          waitingBlock.current = c.id;
          focusCredChip?.();
        }}
      />
      {c.why && <p className="m-0 text-xs text-muted"><WikiText text={c.why} onOpenCard={onOpenCard} /></p>}
    </div>
  );

  return (
    <div ref={root} tabIndex={-1} onKeyDown={onKeyDown} className="grid grid-cols-[minmax(0,1fr)] gap-4 outline-none">
      {hasStrip && (
        <nav aria-label="On this card" className="sticky -top-3 z-10 border-b border-line bg-(--pane-bg,var(--surface)) pt-2">
          <div
            ref={stripRow} data-scroll-x="" onScroll={measureStrip} style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
            className="relative grid auto-cols-max grid-flow-col gap-4 overflow-x-auto px-1 pb-3 pt-1 text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {main.shown.map((c) => (
              <button
                key={c.id} type="button" data-for={c.id} onClick={() => jump(c.id)} aria-current={inView === c.id ? "location" : undefined}
                className={cx("max-w-48 cursor-pointer truncate border-0 bg-transparent p-0 text-xs hover:text-fg", inView === c.id ? "text-accent" : "text-muted")}
              >
                {c.title}
              </button>
            ))}
          </div>
        </nav>
      )}
      <FillBar
        tokens={tokens} hasCred={cred !== null} auto={auto} overrides={overrides} onOverrides={onOverrides} suggest={suggestCtx}
        os={host?.os === "linux" || host?.os === "windows" ? host.os : null}
        fieldRef={(t, el) => (el ? fieldEls.current.set(t, el) : fieldEls.current.delete(t))}
      />
      <div className="grid gap-5">{main.shown.map((c) => block(c, main.msfMarker))}</div>
      {main.shown.length === 0 && commands.length > 0 && <p className="m-0 text-xs text-muted">Nothing here is allowed in this exam.</p>}
      {extra.shown.length > 0 && (
        <details className="grid gap-3">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-label text-muted">Also in Raven</summary>
          <div className="grid gap-5 pt-3">{extra.shown.map((c) => block(c, extra.msfMarker))}</div>
        </details>
      )}
    </div>
  );
}

/** One Field-Manual card: title and where it sits, a strip of its blocks, then the blocks in vault order, filled for the host. */
export function CardView({ cardId, engagementId, hostId, overrides, onOverrides, focusCred, focusBlockId = null, autoFocus = true, onOpenCard }: {
  cardId: string; engagementId: string; hostId: string | null; overrides: Record<string, string>; onOverrides: (next: Record<string, string>) => void;
  focusCred?: () => void;
  /** The block to open at: scrolled into view and outlined until the next keypress. */
  focusBlockId?: string | null;
  autoFocus?: boolean;
  onOpenCard?: (cardId: string) => void;
}) {
  const version = useLibraryVersion();
  const card = getCards().find((c) => c.id === cardId);
  const [obsidianError, setObsidianError] = useState<string>();
  // getLibrary() changes only with the library version.
  /* eslint-disable react-hooks/exhaustive-deps */
  const commands = useMemo(() => getLibrary().filter((c) => c.cardId === cardId), [cardId, version]);
  const also = useMemo(() => {
    const goals = new Set(commands.flatMap((c) => c.goals));
    const ids = new Set(commands.map((c) => c.id));
    return getLibrary().filter((c) => (c.source === "raven" || c.source === "oscp-notes") && !ids.has(c.id) && c.goals.some((g) => goals.has(g)));
  }, [commands, version]);
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!card) return <p className="m-0 text-xs text-muted">That card is not in the library.</p>;
  const openInObsidian = () => {
    setObsidianError(undefined);
    api.openObsidian(card.file).catch((e: unknown) => {
      reportError(e);
      setObsidianError(e instanceof Error ? e.message : String(e));
    });
  };
  return (
    <article className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label={card.title}>
      <header className="grid gap-0.5">
        <h2 className="m-0 text-[15px] font-semibold text-fg">{card.title}</h2>
        <p className="m-0 text-xs text-muted">{categoryLabel(card.category)} · {card.os}</p>
      </header>
      <CommandPane
        key={cardId} commands={commands} also={also} engagementId={engagementId} hostId={hostId} overrides={overrides} onOverrides={onOverrides}
        focusCred={focusCred} focusBlockId={focusBlockId} autoFocus={autoFocus} onOpenCard={onOpenCard} contents
      />
      <div className="grid justify-items-start gap-1">
        <Button size="sm" onClick={openInObsidian}>Open in Obsidian</Button>
        {obsidianError && <p role="alert" className="m-0 text-xs text-warn">{obsidianError}</p>}
      </div>
    </article>
  );
}
