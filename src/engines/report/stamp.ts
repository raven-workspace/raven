import type { ReportNode } from "./types";

/** A block's `source` attr, or null. */
export function sourceOf(node: ReportNode): string | null {
  const source = node.attrs?.source;
  return typeof source === "string" && source !== "" ? source : null;
}

/** FNV-1a 32-bit as 8 hex digits over a block's canonical form: type, text, sorted mark names and children in order.
 *  Attrs are left out, so a block read back from the editor (with its default attrs) hashes as the engine's does. */
export function blockHash(node: ReportNode): string {
  const canon = (n: ReportNode): unknown[] => [n.type, n.text ?? "", (n.marks ?? []).map((m) => m.type).sort(), (n.content ?? []).map(canon)];
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(JSON.stringify(canon(node)))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Each top-level block with a source, its `gen` set to its hash as generated. */
export const stamp = (blocks: ReportNode[]): ReportNode[] =>
  blocks.map((b) => (sourceOf(b) ? { ...b, attrs: { ...b.attrs, gen: blockHash(b) } } : b));
