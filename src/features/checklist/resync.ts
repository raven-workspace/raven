import type { QueryClient } from "@tanstack/react-query";
import { reportError } from "../../lib/lockSignal";
import { storeChanged } from "../../lib/storeChange";
import { resyncBoards } from "./ticks";

/**
 * Reports what a checklist sync over the engagement may have written: checklist rows (ticks, the domain admin cover)
 * and hosts' derived board columns.
 */
export function boardsSynced(qc: QueryClient, engagementId: string): Promise<void> {
  return storeChanged(
    qc,
    { entity: "checklistItem", id: engagementId, change: "updated" },
    { entity: "host", id: engagementId, change: "updated" },
  );
}

/**
 * `resyncBoards`, then a refetch of what it may have written. Not fatal: a failure goes to the shared error path (a
 * locked vault reaches the gate). Resolves when done, so callers can order further work after it.
 */
export async function resyncAndRefresh(qc: QueryClient, engagementId: string): Promise<void> {
  try {
    await resyncBoards(engagementId);
  } catch (e) {
    reportError(e);
    return;
  }
  await boardsSynced(qc, engagementId);
}
