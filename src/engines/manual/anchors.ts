/** The shared anchor slugger: lower-case, runs of non-alphanumerics become one hyphen. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** A `**Table N — Name**` caption line (trimmed): it gets the anchor `table-N`. */
export const TABLE_CAPTION = /^\*\*Table\s+(\d+)\s*[—–-]\s*(.+?)\s*\*\*\s*$/;

/** A fence line: three or more backticks or tildes. A fence closes on the next fence line of the same character. */
export const FENCE = /^\s*(`{3,}|~{3,})/;

/** An outline heading (`#` to `###`, at the start of the line); the text is the raw heading, inline Markdown included. */
export const OUTLINE_HEADING = /^(#{1,3})\s+(.*?)\s*#*\s*$/;

/**
 * Hands out anchor ids in document order. The outline and the renderer both use it, so their ids always match: one
 * dedupe counter shared by `##`, `###` and table captions (`-2`, `-3` for repeats); a heading of only symbols gets
 * `section`.
 */
export function anchorIds() {
  const seen = new Map<string, number>();
  const unique = (base: string): string => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  return {
    heading: (text: string) => unique(slug(text) || "section"),
    table: (n: string) => unique(`table-${n}`),
  };
}
