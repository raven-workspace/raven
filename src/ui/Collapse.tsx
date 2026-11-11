import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ANIMATES, CLOSE_MS, EASE_OUT, FADE_MS, OPEN_MS, canAnimate, prefersReducedMotion } from "./motion";

export interface CollapseProps {
  open: boolean;
  children: ReactNode;
  /** Classes for the wrapper, which takes the content's place in the parent's layout (grid placement, margins). */
  className?: string;
  /**
   * Classes for the content inside the wrapper: its own layout and padding. Padding here, not on the wrapper, so the
   * wrapper can shrink to nothing.
   */
  contentClassName?: string;
  /** Render as a list item (content that sits in a list). */
  as?: "div" | "li";
}

/**
 * Content that opens and closes under a disclosure: the height grows in 200ms and shrinks in 150ms while the content
 * fades, so the rows below slide rather than jump. It stays mounted while closing, inert, then unmounts. A parent's
 * grid or flex gap above it is folded into the motion too, so nothing pops at either end.
 * Reduced motion: no height change, a short fade in; closing is immediate.
 */
export function Collapse({ open, children, className, contentClassName, as: Tag = "div" }: CollapseProps) {
  // Closing keeps the content mounted until the animation ends; with no animation it unmounts at once.
  const [prevOpen, setPrevOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setClosing(!open && ANIMATES && !prefersReducedMotion());
  }
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);
  const running = useRef<Animation | null>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const el = ref.current;
    if (!canAnimate(el)) return;
    // Where it is now: mid-way through an interrupted animation, or at rest (closed means just mounted, height 0).
    const wasRunning = running.current !== null;
    const style = getComputedStyle(el);
    const fromHeight = wasRunning || !open ? el.getBoundingClientRect().height : 0;
    const fromOpacity = wasRunning ? Number(style.opacity) : open ? 0 : 1;
    const fromMargin = wasRunning ? parseFloat(style.marginTop) || 0 : open ? -gapAbove(el) : 0;
    running.current?.cancel();
    el.inert = !open;

    let anim: Animation;
    if (prefersReducedMotion()) {
      running.current = null;
      if (!open) return;
      anim = el.animate([{ opacity: fromOpacity }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
    } else {
      const to = open ? el.scrollHeight : 0;
      const toMargin = open ? 0 : -gapAbove(el);
      el.style.overflow = "hidden";
      anim = el.animate(
        [
          { height: `${fromHeight}px`, marginTop: `${fromMargin}px`, opacity: fromOpacity },
          { height: `${to}px`, marginTop: `${toMargin}px`, opacity: open ? 1 : 0 },
        ],
        { duration: open ? OPEN_MS : CLOSE_MS, easing: EASE_OUT, fill: open ? "none" : "forwards" },
      );
    }
    running.current = anim;
    anim.onfinish = () => {
      if (running.current !== anim) return;
      running.current = null;
      el.style.overflow = "";
      if (!open) setClosing(false);
    };
  }, [open]);

  useLayoutEffect(() => () => running.current?.cancel(), []);

  if (!open && !closing) return null;
  return (
    <Tag ref={ref} className={className}>
      {contentClassName ? <div className={contentClassName}>{children}</div> : children}
    </Tag>
  );
}

/** The row gap the parent puts above this element, when there is something above it to gap from. */
function gapAbove(el: HTMLElement): number {
  const parent = el.parentElement;
  if (!parent || !el.previousElementSibling) return 0;
  const s = getComputedStyle(parent);
  const column = s.display.includes("grid") || (s.display.includes("flex") && s.flexDirection.startsWith("column"));
  return column ? parseFloat(s.rowGap) || 0 : 0;
}
