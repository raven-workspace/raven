import { useSyncExternalStore } from "react";

const EVENTS = ["loading", "loadingdone", "loadingerror"] as const;

function subscribe(onChange: () => void): () => void {
  const fonts = document.fonts as FontFaceSet | undefined;
  if (!fonts) return () => {};
  for (const e of EVENTS) fonts.addEventListener(e, onChange);
  return () => {
    for (const e of EVENTS) fonts.removeEventListener(e, onChange);
  };
}

const loaded = () => (document.fonts as FontFaceSet | undefined)?.status !== "loading";

/**
 * False while a web font is loading. Text laid out before it arrives reflows when it swaps in (`font-display: swap`),
 * so a scroll placed on that text belongs after this turns true. True where there is no `document.fonts` (tests).
 */
export function useFontsLoaded(): boolean {
  return useSyncExternalStore(subscribe, loaded);
}
