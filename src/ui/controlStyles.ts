/** Shared look for text-entry controls (Input, Textarea, Select trigger). */
export const controlBase =
  "rounded-sm border border-line-2 bg-bg text-fg text-body " +
  "hover:border-line-strong aria-invalid:border-warn " +
  "disabled:text-faint disabled:border-line disabled:cursor-not-allowed";

/** Vertical scroll pane: 4px so focus outlines are not clipped, 12px right so overlay scrollbars (WKWebView) never sit over controls. */
export const SCROLL_PANE = "min-h-0 overflow-y-auto p-1 pr-3 [scrollbar-gutter:stable]";
