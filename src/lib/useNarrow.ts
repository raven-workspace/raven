import { useLayoutEffect, useRef, useState } from "react";

/**
 * True while the element's own width is under `limit` px (a container query in code, so a header renders
 * either its text buttons or its icon buttons, never both). Unmeasured (0 wide) counts as wide.
 */
export function useNarrow<T extends HTMLElement>(limit: number) {
  const ref = useRef<T>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setNarrow(w > 0 && w < limit);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [limit]);
  return [ref, narrow] as const;
}
