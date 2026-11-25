import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads, storeChanged } from "../../lib/storeChange";
import type { Engagement } from "../../types/engagement";

export const engagementsKey = ["engagements"] as const;
export const engagementKey = (id: string) => ["engagement", id] as const;

registerReads(engagementsKey, ["engagement"]);
registerReads(["engagement"], ["engagement"]);

export function useEngagements(enabled = true) {
  return useQuery({ queryKey: engagementsKey, queryFn: api.engagementsList, enabled });
}

export function useEngagement(id: string, enabled = true) {
  return useQuery({ queryKey: engagementKey(id), queryFn: () => api.engagementGet(id), enabled });
}

/** Shows a saved engagement at once, then reports the write so everything it touched refetches. */
export function engagementSaved(qc: QueryClient, saved: Engagement, change: "created" | "updated" | "saved" = "updated"): Promise<void> {
  qc.setQueryData(engagementKey(saved.id), saved);
  return storeChanged(qc, { entity: "engagement", id: saved.id, change });
}

/** Forgets a deleted engagement's own record, then reports the delete (its hosts, log and the rest cascade). */
export function engagementDeleted(qc: QueryClient, id: string): Promise<void> {
  qc.removeQueries({ queryKey: engagementKey(id) });
  return storeChanged(qc, { entity: "engagement", id, change: "deleted" });
}
