import type { LogEntry } from "../../types/log";

/**
 * Whether a page node shows a figure, so it takes a "Figure N." number: an evidence node, not moved to an appendix,
 * whose entry exists, is not private, and is a screenshot or a flag with a screenshot.
 */
export function isFigure(node: { type: string; attrs?: Record<string, unknown> }, entryOf: (id: string) => LogEntry | undefined): boolean {
  if (node.type !== "evidence" || node.attrs?.appendix === "moved") return false;
  const entry = entryOf(String(node.attrs?.entryId));
  if (!entry || entry.private) return false;
  return entry.content.kind === "screenshot" || (entry.content.kind === "flag" && !!entry.content.attachmentId);
}

/** A caption that says nothing: empty, or the bare "Screenshot" an uncaptioned paste is titled. */
export const isWeakCaption = (caption: string) => /^\s*(?:screenshot)?\s*$/i.test(caption);

/**
 * A figure's caption: the one written on the page (the node's `caption`), else the log's caption, else the entry's
 * title; for an uncaptioned screenshot (titled just "Screenshot"), the title of the step it tags along with
 * (`stepTitle`) when there is one.
 */
export function captionOf(attrs: Record<string, unknown> | undefined, entry: LogEntry, stepTitle?: string | null): string {
  if (typeof attrs?.caption === "string") return attrs.caption;
  const own = (entry.content.kind === "screenshot" && entry.content.caption) || entry.title;
  return isWeakCaption(own) && stepTitle?.trim() ? stepTitle.trim() : own;
}

/**
 * The step a screenshot at `index` of the page's top-level blocks tags along with: the nearest evidence block above
 * it, past other screenshots (private ones too), whose entry is not a screenshot. Its title is the caption's fallback,
 * so a step that is private or deleted gives none: the screenshot came with that step, and no other step's title is
 * true of it.
 */
export function stepTitleBefore(content: { type: string; attrs?: Record<string, unknown> }[], index: number, entryOf: (id: string) => LogEntry | undefined): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const n = content[i];
    if (n.type !== "evidence") return null;
    const e = entryOf(String(n.attrs?.entryId));
    if (e?.kind === "screenshot") continue;
    return e && !e.private ? e.title : null;
  }
  return null;
}
