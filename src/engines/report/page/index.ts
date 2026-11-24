/**
 * The Page module: everything Raven knows about a report page that already exists. It owns the Block source format
 * (`source.ts`: built with `source`, read with `parseSource`), what one block names (`block.ts`), and what a page
 * holds and where new evidence goes on it. Where an entry would go is the placement plan's; whether it is on the page
 * is always read off the page here (ADR-0001).
 */
export { source, parseSource, sourceString } from "./source";
export type { BlockSource, EntryPart, EntryPartName, FindingPart, HeadingName, HostSourceKind } from "./source";
export { alsoShows, blockSource, copiedFrom, entriesNamedBy, isCopiedFrom, testedListOf, unlinkCopiedFrom } from "./block";
export type { BlockLike } from "./block";
export * from "./place";
