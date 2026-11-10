import type { ReactNode } from "react";

/** A search match: quiet accent wash; the current match (`data-current`, set by the page) is solid accent. */
export const MATCH_CLASS = "rounded-[2px] bg-accent/20 text-fg data-[current]:bg-accent data-[current]:text-bg";

/** Every match of `re` in `text` as `[start, end)` offsets (`matchAll` clones `re`, so a shared global regex is safe). */
export function rangesOf(text: string, re: RegExp | null | undefined): [number, number][] {
  if (!re) return [];
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) if (m[0]) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * `text`, which starts at `offset` in the searched string, with each piece of a match in `<mark data-match>`. A match
 * split across pieces (a command's tokens) is marked `start` in its first piece and `cont` after, so a page counts it
 * once. Without ranges the text comes back as is.
 */
export function highlight(text: string, offset: number, ranges: [number, number][]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    const a = Math.max(s - offset, 0);
    const b = Math.min(e - offset, text.length);
    if (b <= a) continue;
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={a} data-match={s >= offset ? "start" : "cont"} className={MATCH_CLASS}>{text.slice(a, b)}</mark>);
    at = b;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
