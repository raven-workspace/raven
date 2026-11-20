import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Raven's motion: quiet, short, and only where it explains a change. Sections open and close, tab markers glide,
 * panels fade in, drawers slide in from their edge, dialogs settle. Nothing loops and nothing performs (the lock screen
 * is the one exception, DESIGN.md).
 */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
/** A section opening (height and fade). */
export const OPEN_MS = 200;
/** A section closing: faster than it opened. */
export const CLOSE_MS = 150;
/** A panel fading in, and the reduced-motion stand-in for anything that moves. */
export const FADE_MS = 120;
/** A drawer sliding in from the right edge, and back out. */
export const DRAWER_IN_MS = 180;
export const DRAWER_OUT_MS = 120;
/** How far a drawer travels: a nudge from its edge, not its full width. */
const DRAWER_SHIFT = "translateX(16px)";

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A flag that `flash()` turns on for `ms` (a "Copied" tick). Flashing again restarts the timer; unmounting clears it.
 */
export function useFlash(ms: number) {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, flash] as const;
}

/** WAAPI is missing in jsdom: callers skip the animation and land in the end state at once. */
export function canAnimate(el: Element | null): el is HTMLElement {
  return el !== null && typeof (el as HTMLElement).animate === "function";
}

/** Whether exits can animate here at all (jsdom: no, so closed things unmount at once). */
export const ANIMATES = typeof Element !== "undefined" && typeof Element.prototype.animate === "function";

/**
 * Fades `ref` in (120ms, opacity only) whenever `key` changes, not on first show: a new note, card or generator in a
 * pane that stays put. Kept off keys that change per keystroke (search results).
 */
export function useFadeOnChange(ref: RefObject<HTMLElement | null>, key: unknown): void {
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!canAnimate(el)) return;
    const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
    return () => anim.cancel();
  }, [key, ref]);
}

/**
 * A right-edge drawer's presence: it slides 16px in from the edge while fading (180ms), and on close slides back out
 * (120ms), inert, before it unmounts. Reduced motion: a fade in, gone at once on close.
 * Returns `[present, ref]`: render while `present`, with `ref` on the drawer.
 */
export function useDrawerPresence<T extends HTMLElement>(open: boolean): readonly [boolean, RefObject<T | null>] {
  const [prevOpen, setPrevOpen] = useState(open);
  const [leaving, setLeaving] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setLeaving(!open && ANIMATES && !prefersReducedMotion());
  }
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!canAnimate(el)) return;
    const reduce = prefersReducedMotion();
    const away: Keyframe = reduce ? { opacity: 0 } : { opacity: 0, transform: DRAWER_SHIFT };
    const here: Keyframe = reduce ? { opacity: 1 } : { opacity: 1, transform: "none" };
    el.inert = !open;
    if (open) {
      const anim = el.animate([away, here], { duration: reduce ? FADE_MS : DRAWER_IN_MS, easing: reduce ? "ease-out" : EASE_OUT });
      return () => anim.cancel();
    }
    const anim = el.animate([here, away], { duration: DRAWER_OUT_MS, easing: "ease-in", fill: "forwards" });
    anim.onfinish = () => setLeaving(false);
    return () => anim.cancel();
  }, [open]);
  return [open || leaving, ref] as const;
}
