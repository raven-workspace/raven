import { useLayoutEffect, useRef, type RefObject } from "react";
import { useFadeOnChange } from "./motion";

const TAB = { selected: '[role="tab"][aria-selected="true"]', items: '[role="tab"]', attributes: ["aria-selected"] };

/**
 * The selected item's mark (its surface and accent underline, bar or ring), drawn once behind the list and glided to
 * the newly selected item in 180ms, so the eye follows the switch. Place it as the list's first child; the list needs
 * `relative isolate`. By default it follows the tab with `aria-selected="true"`; `follow` points it elsewhere (the
 * sidebar's active link). It tracks the list's scroll and resizes without gliding, and goes straight to place under
 * reduced motion.
 */
export function TabMarker({ className, follow = TAB }: {
  className: string;
  /** What it marks: the selected item, every item (watched for resizes), and the attributes whose change moves it. */
  follow?: { selected: string; items: string; attributes: string[] };
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const marker = ref.current;
    const list = marker?.parentElement;
    if (!marker || !list) return;
    let last: HTMLElement | null = null;
    // While a glide runs, a resize (the new tab turning semibold) retargets it rather than snapping it.
    let glidingUntil = 0;
    const place = () => {
      const tab = list.querySelector<HTMLElement>(follow.selected);
      if (!tab || tab.offsetWidth === 0) {
        marker.style.opacity = "0";
        last = null;
        return;
      }
      // Only a change of tab glides; the first placement and any resize land at once.
      const glide = (last !== null && last !== tab) || performance.now() < glidingUntil;
      if (last !== null && last !== tab) glidingUntil = performance.now() + 200;
      if (!glide) marker.style.transition = "none";
      marker.style.opacity = "1";
      marker.style.width = `${tab.offsetWidth}px`;
      marker.style.height = `${tab.offsetHeight}px`;
      // From the boxes, not offsetLeft/Top: an item's offset parent may be its own positioned wrapper (a menu item).
      const at = tab.getBoundingClientRect();
      const box = list.getBoundingClientRect();
      const x = at.left - box.left - list.clientLeft + list.scrollLeft;
      const y = at.top - box.top - list.clientTop + list.scrollTop;
      marker.style.transform = `translate(${x}px, ${y}px)`;
      if (!glide) {
        void marker.offsetWidth;
        marker.style.transition = "";
      }
      last = tab;
    };
    place();
    const resize = new ResizeObserver(place);
    const watchTabs = () => {
      resize.disconnect();
      resize.observe(list);
      list.querySelectorAll(follow.items).forEach((t) => resize.observe(t));
    };
    watchTabs();
    const mutations = new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList")) watchTabs();
      place();
    });
    mutations.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: follow.attributes });
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
    // The selector set is fixed per list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span
      ref={ref}
      aria-hidden
      data-tab-marker
      className={`pointer-events-none absolute top-0 left-0 -z-10 opacity-0 transition-[transform,width,height] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${className}`}
    />
  );
}

/** Fades a tab panel in (120ms, opacity only) whenever `key` changes; not on first show. */
export function usePanelFade<T extends HTMLElement>(key: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  useFadeOnChange(ref, key);
  return ref;
}
