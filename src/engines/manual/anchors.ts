/** The shared anchor slugger: lower-case, runs of non-alphanumerics become one hyphen. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

const CAPTION_START = /^\*\*Table\s+(\d+)\s*[—–-]\s*/;

export interface TableCaption {
  /** The caption's number: its anchor is `table-N`. */
  number: string;
  /** The bold name after "Table N —", inline Markdown (code, emphasis) kept. */
  name: string;
  /** Any text after the closing `**` (a parenthetical, a note), inline Markdown kept; "" when none. */
  trail: string;
}

/**
 * A `**Table N — Name**` caption line, optionally followed by more text (`**Table 1 — Codes** (nxc, impacket)`): it
 * gets the anchor `table-N`. The name runs to the bold's closing `**`; a `**` inside a code span or after a backslash
 * does not close it, and a nested bold run inside the name is skipped whole. Null for any other line.
 */
export function tableCaption(line: string): TableCaption | null {
  const s = line.trim();
  const m = CAPTION_START.exec(s);
  if (!m) return null;
  let depth = 0;
  for (let j = m[0].length; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "`") {
      const run = /^`+/.exec(s.slice(j))![0];
      const end = s.indexOf(run, j + run.length);
      if (end > 0) j = end + run.length - 1;
      else j += run.length - 1;
      continue;
    }
    if (!s.startsWith("**", j)) continue;
    if (/\s/.test(s[j - 1])) {
      // Opens a nested bold run (`**Table 1 — The **zz** codes**`) when a word follows.
      if (s[j + 2] !== undefined && !/\s/.test(s[j + 2])) depth++;
      j++;
      continue;
    }
    if (depth > 0) {
      depth--;
      j++;
      continue;
    }
    const name = s.slice(m[0].length, j).trim();
    return name ? { number: m[1], name, trail: s.slice(j + 2).trim() } : null;
  }
  return null;
}

/** A fence line: three or more backticks or tildes. Which fence closes which: `openFence` and `closesFence`. */
export const FENCE = /^\s*(`{3,}|~{3,})/;

/** An opening code fence: its character and length. */
export interface Fence {
  ch: string;
  len: number;
}

/** The code fence `line` opens, or null when it is no fence line. */
export function openFence(line: string): Fence | null {
  const f = FENCE.exec(line);
  return f ? { ch: f[1][0], len: f[1].length } : null;
}

/**
 * Whether `line` closes `open` (CommonMark): a fence of the same character, at least as long, with nothing but
 * whitespace after it. So a ````` ````md ````` block can hold a ```` ```sh ```` example.
 */
export function closesFence(line: string, open: Fence): boolean {
  const f = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  return !!f && f[1][0] === open.ch && f[1].length >= open.len;
}

/**
 * Walks a note line by line, telling fenced code from the rest: each call says what `line` is. An unclosed fence runs
 * to the end of the note. The renderer (`readFence`), the outline and search all follow this one rule.
 */
export function fenceWalk(): (line: string) => "fence" | "code" | "text" {
  let open: Fence | null = null;
  return (line) => {
    if (open) {
      if (!closesFence(line, open)) return "code";
      open = null;
      return "fence";
    }
    open = openFence(line);
    return open ? "fence" : "text";
  };
}

/** An outline heading (`#` to `###`, at the start of the line); the text is the raw heading, inline Markdown included. */
export const OUTLINE_HEADING = /^(#{1,3})\s+(.*?)\s*#*\s*$/;

/**
 * Hands out anchor ids in document order. The outline and the renderer both use it, so their ids always match: one
 * dedupe counter shared by `##`, `###` and table captions (`-2`, `-3` for repeats, counting on past any id already
 * given, so "Usage", "Usage 2", "Usage" gives `usage`, `usage-2`, `usage-3`); a heading of only symbols gets `section`.
 */
export function anchorIds() {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  const unique = (base: string): string => {
    let n = seen.get(base) ?? 0;
    let id: string;
    do {
      n++;
      id = n === 1 ? base : `${base}-${n}`;
    } while (used.has(id));
    seen.set(base, n);
    used.add(id);
    return id;
  };
  return {
    heading: (text: string) => unique(slug(text) || "section"),
    table: (n: string) => unique(`table-${n}`),
  };
}
