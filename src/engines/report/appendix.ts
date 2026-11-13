import type { SectionKind } from "../../types/report";
import { lineCount } from "./trim";
import type { PageMeta, ReportNode } from "./types";

export interface AppendixEntry {
  key: string;
  letter: string;
  n: number;
  title: string;
  sectionId: string;
}
/** An owner-written appendix page (+ Page) and its letter. */
export interface AppendixPageLetter {
  sectionId: string;
  letter: string;
}
export interface AppendixIndex {
  entries: AppendixEntry[];
  /** Appendix pages, lettered after the targets' appendices (absent where only references matter). */
  pages?: AppendixPageLetter[];
  /** "E.2", or null for a key that is not moved. */
  refFor(key: string): string | null;
}

const FIRST_LETTER = "A".charCodeAt(0);
/** Lines of a code block past which it is suggested for an appendix page (`suggestMoves`). */
export const MAX_INLINE_LINES = 60;

/** Whether a section is an owner-written appendix page (kind `page`, placement `appendix`). */
export const isAppendixPage = (s: { kind: SectionKind; meta?: unknown }) =>
  s.kind === "page" && (s.meta as Partial<PageMeta> | undefined)?.placement === "appendix";

/**
 * Appendix letters. A target never has entries any more (nothing is moved out of a page); each appendix page (+ Page)
 * takes the next letter from A, by position.
 */
export function numberAppendices(
  sections: { id: string; kind: SectionKind; targetKey: string | null; doc: ReportNode | null; meta?: unknown; position?: number }[],
  // Kept for its callers until the appendix references go (Task 10).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  titleOf?: (node: ReportNode) => string,
): AppendixIndex {
  const pages = sections
    .filter(isAppendixPage)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((s, i) => ({ sectionId: s.id, letter: String.fromCharCode(FIRST_LETTER + i) }));
  return { entries: [], pages, refFor: () => null };
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
