import { parseMarkdown, type Inline } from "./markdown";
import type { ManualNote } from "./types";

/** An inline value's plain text. */
const plain = (parts: Inline[]): string =>
  parts.map((p) => ("text" in p ? p.text : "code" in p ? p.code : "strong" in p ? plain(p.strong) : "em" in p ? plain(p.em) : p.link.label)).join("");

/** A key cell (a flag, an error code, a port, a privilege, a path) up to this many characters keeps to one line. */
const KEY_MAX = 32;

/**
 * A short "key" cell: nothing but inline code (with only commas or slashes between spans, as in "`-u`, `-p`") or a
 * single word, at most `KEY_MAX` characters. Its column then sizes to its widest key instead of being squeezed until
 * `-p PROGRAM` breaks at its space. Bold or italic around the code counts as the code.
 */
export function isKeyCell(parts: Inline[]): boolean {
  const flat: Inline[] = parts.flatMap((p) => ("strong" in p ? p.strong : "em" in p ? p.em : [p]));
  if (flat.some((p) => "strong" in p || "em" in p || "link" in p)) return false;
  const text = plain(flat).trim();
  if (!text || text.length > KEY_MAX) return false;
  const codes = flat.filter((p) => "code" in p).length;
  if (codes === 0) return flat.length === 1 && !/\s/.test(text);
  return flat.every((p) => "code" in p || ("text" in p && /^[\s,/|]*$/.test(p.text)));
}

/** The vault suffixes most Foundations titles with " — Reference"; in the rail it only crowds out the name. */
export const shortTitle = (title: string): string => title.replace(/\s+[—–-]\s+Reference$/i, "");

const PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9_]*\}/;

/** A code span worth offering as a command: it has a `{PLACEHOLDER}` or a space (a bare flag or error code does not). */
export const isInlineCommand = (code: string): boolean => PLACEHOLDER.test(code) || /\s/.test(code);

export const ACTION_HEADER = /^(do( this)?|what to try next|fix)$/i;
export const MEANS_HEADER = /^(means( for an attacker)?|what it means)$/i;
export const CAUSE_HEADER = /^(usually caused by|usual cause)$/i;
export const CARD_HEADER = /^card$/i;

export interface LookupColumns {
  key: 0;
  action: number;
  means?: number;
  cause?: number;
  card?: number;
}

/** Column indexes of a lookup table (key cells in column 0 and an action column), or null for any other table. */
export function lookupColumns(head: Inline[][], rows: Inline[][][]): LookupColumns | null {
  const names = head.map((h) => plain(h).trim());
  const find = (re: RegExp) => {
    const i = names.findIndex((n, j) => j > 0 && re.test(n));
    return i < 0 ? undefined : i;
  };
  const action = find(ACTION_HEADER);
  if (action === undefined) return null;
  if (!rows.every((r) => !r[0] || plain(r[0]).trim() === "" || isKeyCell(r[0]))) return null;
  const means = find(MEANS_HEADER);
  const cause = find(CAUSE_HEADER);
  const card = find(CARD_HEADER);
  return { key: 0, action, ...(means !== undefined ? { means } : {}), ...(cause !== undefined ? { cause } : {}), ...(card !== undefined ? { card } : {}) };
}

export interface LookupRow {
  noteId: string;
  /** The table's `table-N` anchor. */
  anchor: string;
  /** The table's name (its caption without "Table N"). */
  tableName: string;
  /** Position in the table, from 0. */
  row: number;
  /** The key cell as plain text. */
  key: string;
  means: Inline[];
  cause: Inline[];
  action: Inline[];
  /** The action cell's code spans that read as commands, in order. */
  commands: string[];
  card?: { target: string; heading?: string; label: string };
}

const cache = new WeakMap<ManualNote, LookupRow[]>();

/** Every row of every lookup table in a note, in note order. A table without a caption has no anchor and is skipped. */
export function lookupRows(note: ManualNote): LookupRow[] {
  const hit = cache.get(note);
  if (hit) return hit;
  const out: LookupRow[] = [];
  let anchor: string | undefined;
  for (const b of parseMarkdown(note.body)) {
    if (b.kind === "paragraph" && b.anchor) {
      anchor = b.anchor;
      continue;
    }
    if (b.kind !== "table") {
      // A caption names the next table even across a code block, a paragraph or a list; a heading ends its reach.
      if (b.kind === "heading") anchor = undefined;
      continue;
    }
    const caption = anchor;
    anchor = undefined;
    if (!caption) continue;
    const cols = lookupColumns(b.head, b.rows);
    if (!cols) continue;
    const tableName = note.outline.find((o) => o.kind === "table" && o.id === caption)?.text ?? "";
    b.rows.forEach((r, row) => {
      const action = r[cols.action] ?? [];
      const link = cols.card === undefined ? undefined : (r[cols.card] ?? []).find((p) => "link" in p);
      out.push({
        noteId: note.id,
        anchor: caption,
        tableName,
        row,
        key: plain(r[0] ?? []).trim(),
        means: cols.means === undefined ? [] : (r[cols.means] ?? []),
        cause: cols.cause === undefined ? [] : (r[cols.cause] ?? []),
        action,
        commands: action.flatMap((p) => ("code" in p && isInlineCommand(p.code) ? [p.code] : [])),
        ...(link && "link" in link ? { card: link.link } : {}),
      });
    });
  }
  cache.set(note, out);
  return out;
}
