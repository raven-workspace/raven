import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export const settingsKey = ["settings"] as const;

export function useSettings(enabled = true) {
  return useQuery({ queryKey: settingsKey, queryFn: api.settingsGet, enabled });
}
