import { ticksForEntry, type Tick, type TickContext } from "../../engines/checklist";
import { currentLibrary } from "../../engines/library/store";
import { api } from "../../lib/api";
import type { EntryTicks } from "../../types/checklist";
import type { LogEntry, OutputTick } from "../../types/log";
import { servicesByHostOf } from "./state";

/**
 * Reads the engagement, its hosts and services from the store, so ticks see what was just saved. The command library
 * comes from the library store as it is now: the one place ticks read it.
 */
export async function loadTickContext(engagementId: string): Promise<TickContext> {
  const [engagement, hosts, services] = await Promise.all([
    api.engagementGet(engagementId),
    api.hostsList(engagementId),
    api.servicesListEngagement(engagementId),
  ]);
  return { engagement, hosts, servicesByHost: servicesByHostOf(services), library: currentLibrary().commands };
}

/** Command ticks merged with output ticks, deduped by owner and goal; a command tick wins. */
function mergeTicks(commandTicks: Tick[], outputTicks: Tick[]): Tick[] {
  const seen = new Set(commandTicks.map((t) => `${t.ownerId}\u0000${t.goalId}`));
  const out = [...commandTicks];
  for (const t of outputTicks) {
    const key = `${t.ownerId}\u0000${t.goalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** An extraction's output ticks as checklist ticks of its entry. */
export function outputTicksOf(entryId: string, ticks: OutputTick[]): Tick[] {
  return ticks.map((t) => ({ ownerId: t.ownerId, goalId: t.goalId, commandId: `out:${t.parser}`, entryId }));
}

/**
 * An entry's ticks: its command ticks (`ticksForEntry`) and the output ticks its extraction recorded
 * (`commandId: 'out:<parser>'`). `outputTicks` are given on a capture save, before the extraction stores them. An
 * entry whose extraction was undone (`undone`) ticks nothing at all (R3).
 */
export function ticksOfEntry(entry: LogEntry, ctx: TickContext, outputTicks: OutputTick[], undone = false): Tick[] {
  return undone ? [] : mergeTicks(ticksForEntry(entry, ctx), outputTicksOf(entry.id, outputTicks));
}

/** An entry's ticks as the store's conditional write takes them: newly ticked goals are stamped `at`. */
export function entryTicksOf(entryId: string, at: number, ticks: Tick[]): EntryTicks {
  return { entryId, at, ticks: ticks.map((t) => ({ ownerId: t.ownerId, goalId: t.goalId, commandId: t.commandId })) };
}
