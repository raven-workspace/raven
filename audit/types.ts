export type CheckId =
  | "page-overflow" | "overflow" | "truncated" | "clipped" | "offscreen" | "overlap"
  | "squeezed" | "oversized-control" | "mid-token-wrap" | "narrow-wrap"
  | "contrast" | "label"
  | "focus-invisible" | "focus-hidden" | "unreachable" | "focus-trap" | "shortcut"
  // UX (Tasks 5–6 implement these; declared here so the union lives in one place)
  | "hierarchy-flat" | "tight-stack" | "off-scale-spacing" | "tiny-text" | "long-lines"
  | "image-distorted" | "image-cropped"
  | "small-target" | "color-noise" | "competing-primaries" | "unreduced-motion"
  | "missing-empty-state" | "blank-loading" | "silent-error"
  | "flow-over-budget" | "flow-needs-mouse" | "flow-slow";

export interface RawIssue {
  check: CheckId;
  selector: string;
  detail: string;
}

export interface Issue extends RawIssue {
  screen: string;
  width: number;
}
