import type { SectionKind } from "../../types/report";
import { lineCount } from "./trim";
import type { PageMeta, ReportNode } from "./types";

/** An owner-written appendix page (+ Page) and its letter. */
export interface AppendixPageLetter {
  sectionId: string;
  letter: string;
}
export interface AppendixIndex {
  /** Appendix pages, lettered from A by position. */
  pages: AppendixPageLetter[];
}

const FIRST_LETTER = "A".charCodeAt(0);
/** Lines of a code block past which it is suggested for an appendix page (`suggestMoves`). */
export const MAX_INLINE_LINES = 60;

/** Whether a section is an owner-written appendix page (kind `page`, placement `appendix`). */
export const isAppendixPage = (s: { kind: SectionKind; meta?: unknown }) =>
  s.kind === "page" && (s.meta as Partial<PageMeta> | undefined)?.placement === "appendix";

/** Appendix letters: each appendix page (+ Page) takes the next letter from A, by position. Nothing is moved out of a page. */
export function numberAppendices(sections: { id: string; kind: SectionKind; meta?: unknown; position?: number }[]): AppendixIndex {
  const pages = sections
    .filter(isAppendixPage)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((s, i) => ({ sectionId: s.id, letter: String.fromCharCode(FIRST_LETTER + i) }));
  return { pages };
}

/** Code blocks long enough that the owner should move them to an appendix page; `key` is the block's index path ("0.2.1"); its check's id is `move:<key>`. */
export function suggestMoves(doc: ReportNode): { key: string; reason: string }[] {
  const out: { key: string; reason: string }[] = [];
  const walk = (node: ReportNode, path: string) => {
    if (node.type === "codeBlock") {
      const n = lineCount((node.content ?? []).map((c) => c.text ?? "").join(""));
      if (n > MAX_INLINE_LINES) out.push({ key: path, reason: `${n} lines` });
    }
    (node.content ?? []).forEach((child, i) => walk(child, path === "" ? `${i}` : `${path}.${i}`));
  };
  walk(doc, "");
  return out;
}

/* ------------------------------------------------------------------ Move to appendix */

/** Whether two blocks are the same, attr for attr and child for child, whatever order their keys were saved in. */
function sameNode(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameNode((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** A page with nothing on it yet: no block, or a new page's one empty paragraph. */
const isBlank = (blocks: ReportNode[]) => blocks.length === 0 || (blocks.length === 1 && blocks[0].type === "paragraph" && !blocks[0].content?.length);

/**
 * An appendix page with `block` moved to its end (Move to appendix), attrs and all: its source and a figure's entry go
 * with it. A page with nothing on it yet (a new page's one empty paragraph) takes the block in that paragraph's place.
 */
export function withBlockAppended(doc: ReportNode, block: ReportNode): ReportNode {
  const content = doc.content ?? [];
  return { ...doc, content: isBlank(content) ? [block] : [...content, block] };
}

/**
 * Undo of `withBlockAppended`: the page without its last top-level block equal to `block`, one empty paragraph when
 * nothing is left. Null when the page holds no such block (the owner changed it or took it off).
 */
export function withoutAppended(doc: ReportNode, block: ReportNode): ReportNode | null {
  const content = doc.content ?? [];
  let at = content.length - 1;
  while (at >= 0 && !sameNode(content[at], block)) at--;
  if (at === -1) return null;
  const rest = content.filter((_, i) => i !== at);
  return { ...doc, content: rest.length > 0 ? rest : [{ type: "paragraph" }] };
}
