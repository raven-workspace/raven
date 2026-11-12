import type { SectionKind } from "../../types/report";
import { testedNotExploited } from "./coverage";
import { lineCount } from "./trim";
import type { GeneratedAttrs, PageMeta, ReportData, ReportNode } from "./types";

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
const MOVABLE = new Set(["evidence", "exploit", "generated"]);
/** Lines of output past which an inline block is suggested for an appendix (`suggestMoves`). */
export const MAX_INLINE_LINES = 60;
const MAX_INLINE_ROWS = 15;

const isMoved = (node: ReportNode) =>
  MOVABLE.has(node.type) && (node.attrs?.appendix === "moved" || node.attrs?.appendix === "split");

/** Moved nodes of a doc in document order, each with its index path ("0.2.1"). */
function movedNodes(doc: ReportNode): { path: string; node: ReportNode }[] {
  const found: { path: string; node: ReportNode }[] = [];
  const walk = (node: ReportNode, path: string) => {
    if (path !== "" && isMoved(node)) found.push({ path, node });
    (node.content ?? []).forEach((child, i) => walk(child, path === "" ? `${i}` : `${path}.${i}`));
  };
  walk(doc, "");
  return found;
}

/** Whether a section is an owner-written appendix page (kind `page`, placement `appendix`). */
export const isAppendixPage = (s: { kind: SectionKind; meta?: unknown }) =>
  s.kind === "page" && (s.meta as Partial<PageMeta> | undefined)?.placement === "appendix";

/**
 * Appendix letters (§5.6, §10.4). Each target section with moved content gets the next letter from A, in report order,
 * its moved nodes numbered in document order; then each appendix page (+ Page) takes the next letter, by position.
 * An appendix page is one page: its own blocks are not numbered.
 */
export function numberAppendices(
  sections: { id: string; kind: SectionKind; targetKey: string | null; doc: ReportNode | null; meta?: unknown; position?: number }[],
  titleOf: (node: ReportNode) => string,
): AppendixIndex {
  const entries: AppendixEntry[] = [];
  let next = FIRST_LETTER;
  for (const s of sections) {
    if (s.kind !== "target" && s.kind !== "ad") continue;
    const moved = s.doc ? movedNodes(s.doc) : [];
    if (moved.length === 0) continue;
    const letter = String.fromCharCode(next++);
    moved.forEach(({ path, node }, i) =>
      entries.push({ key: `${s.id}:${path}`, letter, n: i + 1, title: titleOf(node), sectionId: s.id }),
    );
  }
  const pages = sections
    .filter(isAppendixPage)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((s) => ({ sectionId: s.id, letter: String.fromCharCode(next++) }));
  const byKey = new Map(entries.map((e) => [e.key, `${e.letter}.${e.n}`]));
  return { entries, pages, refFor: (key) => byKey.get(key) ?? null };
}

function keptLines(node: ReportNode, data: ReportData): number {
  const attrs = node.attrs ?? {};
  const entry = data.log.find((e) => e.id === attrs.entryId);
  if (!entry || entry.content.kind !== "command") return 0;
  const block = typeof attrs.block === "number" ? attrs.block : null;
  const blocks = block === null ? entry.content.blocks : entry.content.blocks.slice(block, block + 1);
  const total = blocks.reduce((sum, b) => sum + lineCount(b.output ?? ""), 0);
  const keep = attrs.keep as [number, number][] | null | undefined;
  if (!keep) return total;
  // Ranges index the block's output (the whole entry's joined output when block is null).
  const merged = [...keep].sort((a, b) => a[0] - b[0]).reduce<[number, number][]>((acc, [a, b]) => {
    const top = acc[acc.length - 1];
    if (top && a <= top[1] + 1) top[1] = Math.max(top[1], b);
    else acc.push([a, b]);
    return acc;
  }, []);
  return merged.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(total - 1, b) - Math.max(0, a) + 1), 0);
}

function generatedRows(attrs: GeneratedAttrs, data: ReportData): number {
  switch (attrs.kind) {
    case "tested":
      return testedNotExploited(data, attrs.hostId).length;
    default:
      return 0;
  }
}

/** Inline blocks long enough that the owner should move them to an appendix; `key` is the node index path ("0.2.1"), to be prefixed with the section id. */
export function suggestMoves(doc: ReportNode, data: ReportData): { key: string; reason: string }[] {
  const out: { key: string; reason: string }[] = [];
  const walk = (node: ReportNode, path: string) => {
    const attrs = node.attrs ?? {};
    if (path !== "" && attrs.appendix === "inline") {
      if (node.type === "evidence") {
        const n = keptLines(node, data);
        if (n > MAX_INLINE_LINES) out.push({ key: path, reason: `${n} lines of output` });
      } else if (node.type === "exploit") {
        // An unmodified exploit is shown as its URL, never its code: nothing to move.
        const file = data.findingFiles.find((f) => f.id === attrs.fileId);
        const n = file?.modified ? lineCount(file.content) : 0;
        if (n > MAX_INLINE_LINES) out.push({ key: path, reason: `${n} lines of exploit code` });
      } else if (node.type === "generated") {
        const g = attrs as unknown as GeneratedAttrs;
        if (g.kind === "tested") {
          const n = generatedRows(g, data);
          if (n > MAX_INLINE_ROWS) out.push({ key: path, reason: `${n} rows` });
        }
      }
    }
    (node.content ?? []).forEach((child, i) => walk(child, path === "" ? `${i}` : `${path}.${i}`));
  };
  walk(doc, "");
  return out;
}
