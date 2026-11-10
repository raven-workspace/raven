/** The search parameter that opens a note with its match bar. */
export const MANUAL_QUERY = "q";
/** The search parameter naming the lookup row (in `anchor`'s table) a ⌘K landing is for. */
export const MANUAL_ROW = "row";

/**
 * A note opened from ⌘K: at the query's matches, starting in `anchor`'s section (the hash). With `row`, the landing is
 * that row of `anchor`'s table: its first match, or the row itself when the query matches nothing in it.
 */
export const manualSearchPath = (noteId: string, query: string, anchor?: string, row?: number): string =>
  `/manual/${encodeURIComponent(noteId)}?${MANUAL_QUERY}=${encodeURIComponent(query.trim())}${row !== undefined && anchor ? `&${MANUAL_ROW}=${row}` : ""}${anchor ? `#${anchor}` : ""}`;
