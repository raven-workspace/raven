import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { OutlineEntry } from "../../engines/manual";
import { parseInline, type Inline } from "../../engines/manual/markdown";
import { cx } from "../../lib/cx";
import { prefersReducedMotion } from "../../ui/motion";
import "./ManualOutline.scss";

/** Within this many px of the pane's top the first entry is current; within this many of its end, the last. */
const EDGE = 48;
/** The band the scroll-spy watches: 20px in from the pane's top, down to 60% of its height. */
const BAND_MARGIN = "-20px 0px -40% 0px";
const BAND_TOP = 20;
/** A heading within this many px of the pane's top edge is on it (sub-pixel scroll positions). */
const EDGE_PX = 1;
/** A jump's heading within this many px of the pane's top was reached (scroll-margin, rounding). */
const SLACK = 24;
/** A jump owns the current entry until its scroll has been quiet this long. */
const SETTLE_MS = 150;

/** How a jump scrolls: smooth, or at once ("auto", which WKWebView takes) when the owner asks for reduced motion. */
export const jumpBehavior = (): ScrollBehavior =>
  prefersReducedMotion() ? "auto" : "smooth";

const entryEl = (pane: HTMLElement, id: string) => pane.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);

/**
 * The scroll-spy for the note pane. The current entry is the first heading inside the band (an IntersectionObserver on
 * the pane), or the last one above it when none is; the first entry is pinned current at the top of the pane and the
 * last at its end. A jump owns the current entry while its scroll runs, and keeps it where the pane can't scroll the
 * heading to the top (the end of a note, or a short one) until the owner scrolls.
 *
 * Keyed by the note as well as its ids: tool notes share headings (Install, Key Flags), and a new note must observe its
 * own heading elements and start with nothing current.
 */
export function useOutlineSpy(paneRef: RefObject<HTMLElement | null>, noteId: string, ids: string[]) {
  const key = [noteId, ...ids].join("\n");
  const [spy, setSpy] = useState({ key, at: -1 });
  const current = spy.key === key ? spy.at : -1;
  const jumped = useRef(-1);
  const locked = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Ends a jump's lock once its scroll is quiet; set by the effect below. */
  const unlock = useRef<() => void>(() => {});

  useEffect(() => {
    const pane = paneRef.current;
    const list = key.split("\n").slice(1);
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
    /** The jumped heading sits on the pane's top, or the pane is at its end (or can't scroll at all). */
    const holds = (i: number) => {
      const el = entryEl(pane, list[i] ?? "");
      const left = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      if (left <= EDGE) return true;
      return !!el && Math.abs(el.getBoundingClientRect().top - pane.getBoundingClientRect().top) <= SLACK;
    };
    unlock.current = () => {
      locked.current = false;
      // A scroll by the owner inside the jump's settle time moved the note on: the jump no longer holds.
      if (jumped.current >= 0 && !holds(jumped.current)) jumped.current = -1;
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
   * The entry `]` (+1) or `[` (-1) goes to, read from what's at the top of the note pane, not from the marked entry:
   * `]` the first heading strictly below the pane's top edge, `[` the last one strictly above it (the start of the
   * section being read, or the one before when a heading sits on the edge). A jump the pane couldn't bring to the top
   * (the end of a note) still holds, so [ ] step on from it until the owner scrolls. -1: nowhere to go (`[` above the
   * first heading, `]` in the last section).
   */
  const step = (dir: 1 | -1): number => {
    if (jumped.current >= 0) {
      const to = jumped.current + dir;
      return to >= 0 && to < ids.length ? to : -1;
    }
    const pane = paneRef.current;
    if (!pane) return -1;
    const top = pane.getBoundingClientRect().top;
    const at = ids.map((id) => {
      const el = entryEl(pane, id);
      return el ? el.getBoundingClientRect().top - top : Number.NaN;
    });
    if (dir > 0) return at.findIndex((y) => y > EDGE_PX);
    let prev = -1;
    at.forEach((y, i) => {
      if (y < -EDGE_PX) prev = i;
    });
    return prev;
  };

  return { current, jump, step };
}

/** An entry's inline Markdown as the note shows it: code in mono, emphasis and link markers gone. */
function OutlineText({ parts }: { parts: Inline[] }): ReactNode {
  return parts.map((p, i) => {
    if ("text" in p) return p.text;
    if ("code" in p) return <code key={i} className="manual-outline__code">{p.code}</code>;
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
      // The aside's sticky label covers its top: an entry under it is out of view.
      const top = Math.max(s.top, scroller.querySelector("[data-outline-head]")?.getBoundingClientRect().bottom ?? s.top);
      const r = el.getBoundingClientRect();
      if (r.top < top) scroller.scrollTop -= top - r.top;
      else if (r.bottom > s.bottom) scroller.scrollTop += r.bottom - s.bottom;
    }
    // The disclosure's list measures 0 until it is laid out; a wrapped entry moves the ones below it.
    const ro = new ResizeObserver(place);
    ro.observe(list);
    return () => ro.disconnect();
  }, [current, outline, follow]);

  // Every h2 shows; the h3s and tables under an h2 show only while the current section is that h2 or one of them.
  const owner = (i: number) => {
    for (let k = i; k >= 0; k--) if (outline[k]?.kind === "h2") return k;
    return -1;
  };
  // Before a section is current the note sits at its top: the first h2's own entries show.
  const open = owner(Math.max(current, 0));
  if (outline.length === 0) return <p className="manual-outline__empty">No sections</p>;
  return (
    <div ref={listRef} className="manual-outline">
      <span aria-hidden className="manual-outline__track" />
      <span
        ref={barRef} aria-hidden hidden data-testid="section-indicator"
        className="manual-outline__bar"
      />
      <ul className="manual-outline__list">
        {outline.map((o, i) => {
          const on = i === current;
          if (o.kind !== "h2" && owner(i) !== open) return null;
          return (
            <li key={o.id} className="manual-outline__item">
              <button
                type="button" data-index={i} aria-current={on ? "location" : undefined} onClick={() => onPick(i)}
                className={cx(
                  "manual-outline__entry",
                  o.kind === "h2" && "manual-outline__entry--h2",
                  o.kind === "table" && "manual-outline__entry--table",
                )}
              >
                {o.kind === "table" ? (
                  <>
                    <span className="manual-outline__number">Table {o.number}</span>
                    <span className="manual-outline__text"><OutlineText parts={parseInline(o.text)} /></span>
                  </>
                ) : (
                  <span className="manual-outline__text"><OutlineText parts={parseInline(o.text)} /></span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
