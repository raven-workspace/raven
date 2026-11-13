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

/** Code blocks long enough that the owner should move them to an appendix page; `key` is the block's index path ("0.2.1"), to be prefixed with the section id. */
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
