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

/** A figure's caption: the one written on the page (the node's `caption`), else the log's caption, else the entry's title. */
export function captionOf(attrs: Record<string, unknown> | undefined, entry: LogEntry): string {
  if (typeof attrs?.caption === "string") return attrs.caption;
  return (entry.content.kind === "screenshot" && entry.content.caption) || entry.title;
}
