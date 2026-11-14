import { useLayoutEffect, useRef, useState } from "react";

/**
 * True while the element's own width is under `limit` px (a container query in code, so a header renders
 * either its text buttons or its icon buttons, never both). Unmeasured (0 wide) counts as wide.
 */
export function useNarrow<T extends HTMLElement>(limit: number) {
  const [ref, width] = useWidth<T>();
  return [ref, width > 0 && width < limit] as const;
}

/** The element's own width in whole px, kept current as it resizes; 0 until measured (before the first paint). */
export function useWidth<T extends HTMLElement>() {
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
