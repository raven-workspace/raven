import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { OutlineEntry } from "../../engines/manual";
import { parseInline, type Inline } from "../../engines/manual/markdown";
import { cx } from "../../lib/cx";

/** Within this many px of the pane's top the first entry is current; within this many of its end, the last. */
const EDGE = 48;
/** The band the scroll-spy watches: 20px in from the pane's top, down to 60% of its height. */
const BAND_MARGIN = "-20px 0px -40% 0px";
const BAND_TOP = 20;
/** How far below the pane's top a heading may sit and still count as reached by a jump. */
const SLACK = 24;
/** A jump owns the current entry until its scroll has been quiet this long. */
const SETTLE_MS = 150;

/** How a jump scrolls: smooth, or instant when the owner asks for reduced motion. */
export const jumpBehavior = (): ScrollBehavior =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";

const entryEl = (pane: HTMLElement, id: string) => pane.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);

/**
 * The scroll-spy for the note pane. The current entry is the first heading inside the band (an IntersectionObserver on
 * the pane), or the last one above it when none is; the first entry is pinned current at the top of the pane and the
 * last at its end. A jump owns the current entry while its scroll runs, and keeps it where the pane can't scroll the
 * heading to the top (the start or the end of a note) until the owner scrolls.
 */
export function useOutlineSpy(paneRef: RefObject<HTMLElement | null>, ids: string[]) {
  const key = ids.join("\n");
  const [spy, setSpy] = useState({ key, at: -1 });
  const current = spy.key === key ? spy.at : -1;
  const jumped = useRef(-1);
  const locked = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Ends a jump's lock once its scroll is quiet; set by the effect below. */
  const unlock = useRef<() => void>(() => {});

  useEffect(() => {
    const pane = paneRef.current;
    const list = key ? key.split("\n") : [];
    jumped.current = -1;
    locked.current = false;
    if (!pane || list.length === 0) return;
    const visible = new Map<string, boolean>();
    const set = (at: number) => setSpy((s) => (s.key === key && s.at === at ? s : { key, at }));

    /** `byScroll`: the owner scrolled, which ends a jump's hold on the current entry. */
    const read = (byScroll: boolean): number => {
      const last = list.length - 1;
      const left = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      if (pane.scrollHeight - pane.clientHeight > EDGE && left <= EDGE) return jumped.current >= 0 ? jumped.current : last;
      if (!byScroll && jumped.current >= 0) return jumped.current;
      jumped.current = -1;
      if (pane.scrollTop <= EDGE) return 0;
      const seen = list.findIndex((id) => visible.get(id));
      if (seen >= 0) return seen;
      const top = pane.getBoundingClientRect().top + BAND_TOP;
      let at = 0;
      list.forEach((id, i) => {
        const el = entryEl(pane, id);
        if (el && el.getBoundingClientRect().top <= top) at = i;
      });
      return at;
    };
    const sync = (byScroll: boolean) => {
      if (!locked.current) set(read(byScroll));
    };
    unlock.current = () => {
      locked.current = false;
      sync(false);
    };

    let frame = 0;
    const onScroll = () => {
      if (locked.current) {
        clearTimeout(settle.current);
        settle.current = setTimeout(unlock.current, SETTLE_MS);
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => sync(true));
    };
    const onScrollEnd = () => {
      if (!locked.current) return;
      clearTimeout(settle.current);
      unlock.current();
    };
    pane.addEventListener("scroll", onScroll, { passive: true });
    pane.addEventListener("scrollend", onScrollEnd);
    window.addEventListener("resize", onScroll);

    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) visible.set(e.target.id, e.isIntersecting);
          sync(false);
        },
        { root: pane, rootMargin: BAND_MARGIN, threshold: 0 },
      );
      for (const id of list) {
        const el = entryEl(pane, id);
        if (el) io.observe(el);
      }
    }
    return () => {
      io?.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(settle.current);
      pane.removeEventListener("scroll", onScroll);
      pane.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("resize", onScroll);
    };
  }, [key, paneRef]);

  /** Scrolls the note to entry `i` and makes it current; returns its element, for focus. */
  const jump = (i: number, behavior: ScrollBehavior = "auto"): HTMLElement | null => {
    const pane = paneRef.current;
    const id = ids[i];
    if (!pane || id === undefined) return null;
    jumped.current = i;
    locked.current = true;
    setSpy({ key, at: i });
    clearTimeout(settle.current);
    settle.current = setTimeout(() => unlock.current(), SETTLE_MS);
    const el = entryEl(pane, id);
    el?.scrollIntoView?.({ block: "start", behavior });
    return el;
  };

  /**
   * The entry `]` (+1) or `[` (-1) goes to. A current heading still below the pane's top (the band marks it before
   * it's reached) is where `]` goes first.
   */
  const step = (dir: 1 | -1): number => {
    if (current < 0) return 0;
    if (dir < 0) return Math.max(0, current - 1);
    const pane = paneRef.current;
    const el = pane ? entryEl(pane, ids[current] ?? "") : null;
    const ahead = !!pane && !!el && el.getBoundingClientRect().top - pane.getBoundingClientRect().top > SLACK;
    return ahead ? current : Math.min(ids.length - 1, current + 1);
  };

  return { current, jump, step };
}

/** An entry's inline Markdown as the note shows it: code in mono, emphasis and link markers gone. */
function OutlineText({ parts }: { parts: Inline[] }): ReactNode {
  return parts.map((p, i) => {
    if ("text" in p) return p.text;
    if ("code" in p) return <code key={i} className="font-mono text-code">{p.code}</code>;
    if ("strong" in p) return <OutlineText key={i} parts={p.strong} />;
    if ("em" in p) return <OutlineText key={i} parts={p.em} />;
    return p.link.label;
  });
}

/**
 * "On this page": the note's headings and named tables on a hairline track, h3s and tables indented under their h2. A
 * lime bar slides along the track to the current entry. A table shows "Table N" and its name as two parts. Clicking
 * (or ↵ on) an entry scrolls the note to it. `follow`: the list's own scroller (the aside) keeps the current entry in
 * view.
 */
export function ManualOutline({ outline, current, onPick, follow = false }: {
  outline: OutlineEntry[]; current: number; onPick: (index: number) => void; follow?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  // The bar is placed straight on the DOM: it moves with every section change and needs no re-render.
  useLayoutEffect(() => {
    const list = listRef.current;
    const bar = barRef.current;
    if (!list || !bar) return;
    const place = () => {
      const el = list.querySelector<HTMLElement>(`[data-index="${current}"]`);
      bar.hidden = !el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      bar.style.transform = `translateY(${r.top - list.getBoundingClientRect().top}px)`;
      bar.style.height = `${r.height}px`;
    };
    place();
    const scroller = follow ? list.closest("aside") : null;
    const el = list.querySelector<HTMLElement>(`[data-index="${current}"]`);
    if (scroller && el) {
      const s = scroller.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top < s.top) scroller.scrollTop -= s.top - r.top;
      else if (r.bottom > s.bottom) scroller.scrollTop += r.bottom - s.bottom;
    }
    // The disclosure's list measures 0 until it is laid out; a wrapped entry moves the ones below it.
    const ro = new ResizeObserver(place);
    ro.observe(list);
    return () => ro.disconnect();
  }, [current, outline, follow]);

  if (outline.length === 0) return <p className="m-0 px-3 text-meta text-muted">No sections</p>;
  return (
    <div ref={listRef} className="relative grid">
      <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-line" />
      <span
        ref={barRef} aria-hidden hidden data-testid="section-indicator"
        className="absolute left-0 top-0 w-0.5 rounded-full bg-accent transition-[transform,height] duration-150 ease-out motion-reduce:transition-none"
      />
      <ul className="m-0 grid list-none gap-0 p-0">
        {outline.map((o, i) => {
          const on = i === current;
          return (
            <li key={o.id} className="grid">
              <button
                type="button" data-index={i} aria-current={on ? "location" : undefined} onClick={() => onPick(i)}
                className={cx(
                  "grid min-h-7 w-full cursor-default items-start rounded-sm border-0 bg-transparent py-1 pr-2 text-left text-meta transition-colors duration-150 motion-reduce:transition-none",
                  o.kind === "h2" ? "pl-3" : "pl-6",
                  o.kind === "table" && "grid-cols-[max-content_minmax(0,1fr)] gap-2",
                  on ? "text-fg" : "text-muted-2 hover:text-fg",
                )}
              >
                {o.kind === "table" ? (
                  <>
                    <span className={on ? undefined : "text-muted"}>Table {o.number}</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]"><OutlineText parts={parseInline(o.text)} /></span>
                  </>
                ) : (
                  <span className="min-w-0 [overflow-wrap:anywhere]"><OutlineText parts={parseInline(o.text)} /></span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
