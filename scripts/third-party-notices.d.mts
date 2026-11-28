// Types for the parts of third-party-notices.mjs that src/test/thirdPartyNotices.test.ts checks.
export type SpdxTree = { id: string } | { and: SpdxTree[] } | { or: SpdxTree[] };
export function parseSpdx(expr: string): SpdxTree;
export function chooseLicences(tree: SpdxTree, list: string[]): string[] | null;
