import type { QueryClient } from "@tanstack/react-query";
import { reportError } from "../../lib/lockSignal";
import { checklistKey } from "./state";
import { resyncBoards } from "./ticks";

/**
 * `resyncBoards`, then a refetch of what it may have written: the checklist (the domain admin cover) and the hosts
 * (derived board columns). Not fatal: a failure goes to the shared error path (a locked vault reaches the gate).
 * Resolves when done, so callers can order further work after it.
 */
export async function resyncAndRefresh(qc: QueryClient, engagementId: string): Promise<void> {
  try {
    await resyncBoards(engagementId);
  } catch (e) {
    reportError(e);
    return;
  }
  await Promise.all([
    qc.invalidateQueries({ queryKey: checklistKey(engagementId) }),
    qc.invalidateQueries({ queryKey: ["hosts", engagementId] }),
  ]);
}
