import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * The element's width, once measured; undefined until then (and in tests, which have no layout). Measured as the ref
 * attaches, during the commit, so the first paint already knows it: nothing paints in one layout and then switches.
 */
export function useWidth() {
  const [width, setWidth] = useState<number>();
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const set = (w: number) => { if (w > 0) setWidth(w); };
    set(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => set(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * The element's own width in whole px through an object ref, kept current as it resizes; 0 until measured (before the
 * first paint). Unlike useWidth (a callback ref, undefined until measured), this reads the ref in a layout effect.
 */
export function useWidthRef<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
