import { useCallback, useState } from "react";

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
