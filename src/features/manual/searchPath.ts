/** The search parameter that opens a note with its match bar. */
export const MANUAL_QUERY = "q";

/** A note opened from ⌘K: at the query's matches, starting in `anchor`'s section (the hash). */
export const manualSearchPath = (noteId: string, query: string, anchor?: string): string =>
  `/manual/${encodeURIComponent(noteId)}?${MANUAL_QUERY}=${encodeURIComponent(query.trim())}${anchor ? `#${anchor}` : ""}`;
