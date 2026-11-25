import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { staleAfter, type Entity, type StoreChange } from "../engines/staleness";

export type { Entity, StoreChange } from "../engines/staleness";

/** Each registered query key prefix and the entities its queries read. */
const reads = new Map<string, { key: QueryKey; entities: readonly Entity[] }>();

/**
 * Declares that every query under `key` (a prefix: `["services"]` covers `["services", hostId]`) reads `entities`.
 * Each feature registers its own keys beside them, so a write anywhere refetches them without naming them.
 */
export function registerReads(key: QueryKey, entities: readonly Entity[]): void {
  reads.set(JSON.stringify(key), { key, entities });
}

/** The registered key prefixes the store changes leave stale. */
export function staleKeys(...changes: StoreChange[]): QueryKey[] {
  const stale = new Set<Entity>(changes.flatMap((c) => [...staleAfter(c)]));
  return [...reads.values()].filter((r) => r.entities.some((e) => stale.has(e))).map((r) => r.key);
}

/**
 * Reports what a write did to the vault. The staleness map turns it into what is now out of date and those queries
 * refetch. A write over several rows reports each. Resolves once the active queries have refetched.
 */
export async function storeChanged(qc: QueryClient, ...changes: StoreChange[]): Promise<void> {
  await Promise.all(staleKeys(...changes).map((queryKey) => qc.invalidateQueries({ queryKey })));
}
