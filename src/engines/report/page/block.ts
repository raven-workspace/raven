import { type BlockSource, parseSource } from "./source";

/**
 * What one block on a page says about where it came from, read off its own attrs (never its children's). It takes a
 * plain `{ type, attrs }`, so the editor can ask it about a ProseMirror node as readily as the engines ask about a
 * saved page.
 *
 * A block names a log entry in two ways, and they mean different things:
 * - **copied from**: the block's text or picture is that entry's (its `entry:` source, or a figure's `entryId`). It
 *   follows that entry: Refresh rebuilds it, and the checks flag it when the entry goes private or is deleted.
 * - **also shows**: the block holds that entry's evidence, but its text is another entry's (a flag whose value a
 *   command's output prints). Recorded in the hidden `also` attr so the page still counts the entry as placed.
 */
export interface BlockLike {
  type: string;
  attrs?: Record<string, unknown> | null;
}

/** The block's source, read; null when it has none or it is no known kind. */
export function blockSource(b: BlockLike): BlockSource | null {
  return parseSource(typeof b.attrs?.source === "string" ? b.attrs.source : null);
}

/** The entry a figure shows, or null. */
function figureEntry(b: BlockLike): string | null {
  const id = b.attrs?.entryId;
  return b.type === "figure" && typeof id === "string" && id !== "" ? id : null;
}

/** The entry an `entry:` source names, or null. */
function sourceEntry(b: BlockLike): string | null {
  const s = blockSource(b);
  return s?.kind === "entry" ? s.entryId : null;
}

/** The entry the block was copied from: a figure's entry, else its `entry:` source's; null for any other block. */
export function copiedFrom(b: BlockLike): string | null {
  return figureEntry(b) ?? sourceEntry(b);
}

/** Whether the block was copied from `entryId`, by its source or, for a figure, by the entry it shows. */
export function isCopiedFrom(b: BlockLike, entryId: string): boolean {
  return figureEntry(b) === entryId || sourceEntry(b) === entryId;
}

/** The entries the block also shows (its `also`), in order. */
export function alsoShows(b: BlockLike): string[] {
  const also = b.attrs?.also;
  return Array.isArray(also) ? also.filter((id): id is string => typeof id === "string" && id !== "") : [];
}

/** Every entry the block places itself: copied from (by source and by figure) and also shows. */
export function entriesNamedBy(b: BlockLike): string[] {
  return [sourceEntry(b), figureEntry(b), ...alsoShows(b)].filter((id): id is string => id !== null);
}

/** The machine whose Also tested list the block is part of, or null. */
export function testedListOf(b: BlockLike): string | null {
  const s = blockSource(b);
  return s?.kind === "tested" ? s.hostId : null;
}

/**
 * The block's attrs with its copied-from link to `entryId` dropped, so its text is the owner's own and no longer
 * follows that entry's privacy or deletion: an `entry:` source for it cleared (its `gen` hash with it), a figure's
 * entry cleared. Its `also` is left alone: that evidence is another entry's text. Null when the block isn't copied
 * from `entryId`.
 */
export function unlinkCopiedFrom(b: BlockLike, entryId: string): Record<string, unknown> | null {
  const fromSource = sourceEntry(b) === entryId;
  const fromFigure = figureEntry(b) === entryId;
  if (!fromSource && !fromFigure) return null;
  const attrs: Record<string, unknown> = { ...b.attrs };
  if (fromSource) Object.assign(attrs, { source: null, gen: null });
  if (fromFigure) attrs.entryId = null;
  return attrs;
}
