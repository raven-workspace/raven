/** Every check id, at runtime too (an opt-out naming an id that is not here is an error). */
export const CHECK_IDS = [
  "page-overflow", "document-scroll", "overflow", "truncated", "clipped", "offscreen", "overlap",
  "squeezed", "oversized-control", "mid-token-wrap", "narrow-wrap",
  "contrast", "label",
  "focus-invisible", "focus-hidden", "unreachable", "focus-trap", "shortcut",
  "hierarchy-flat", "tight-stack", "off-scale-spacing", "tiny-text", "long-lines",
  "image-distorted", "image-cropped",
  "small-target", "color-noise", "competing-primaries", "unreduced-motion",
  "missing-empty-state", "blank-loading", "silent-error",
  "flow-over-budget", "flow-needs-mouse", "flow-slow",
  // Opt-outs: every `data-audit-allow` is listed; one without a `data-audit-reason`, or naming no real check, is an error.
  "opt-out", "opt-out-unreasoned", "opt-out-invalid",
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

export interface RawIssue {
  check: CheckId;
  selector: string;
  detail: string;
}

export interface Issue extends RawIssue {
  screen: string;
  width: number;
}

/**
 * Checks that fail the run (spec §2.5), on every screen, width and state run. Everything else is reported only.
 * An element opts out of one check with `data-audit-allow="<check>"` plus a `data-audit-reason`.
 */
export const FAILING_CHECKS: ReadonlySet<CheckId> = new Set<CheckId>([
  "tiny-text", "small-target", "overlap", "page-overflow", "document-scroll", "overflow", "clipped", "mid-token-wrap", "opt-out-unreasoned", "opt-out-invalid",
]);

/** The issues that fail the run, one line each, for the test's failure message. */
export function gateFailures(issues: RawIssue[]): string[] {
  return issues.filter((i) => FAILING_CHECKS.has(i.check)).map((i) => `${i.check} ${i.selector}: ${i.detail}`);
}
