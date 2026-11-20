import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export const engagementsKey = ["engagements"] as const;
export const engagementKey = (id: string) => ["engagement", id] as const;

export function useEngagements(enabled = true) {
  return useQuery({ queryKey: engagementsKey, queryFn: api.engagementsList, enabled });
}

export function useEngagement(id: string, enabled = true) {
  return useQuery({ queryKey: engagementKey(id), queryFn: () => api.engagementGet(id), enabled });
}
