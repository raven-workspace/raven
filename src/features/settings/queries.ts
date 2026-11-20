import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Settings } from "../../types/settings";

export const settingsKey = ["settings"] as const;

export function useSettings(enabled = true) {
  return useQuery({ queryKey: settingsKey, queryFn: api.settingsGet, enabled });
}

/** The settings a command fill reads: LHOST, LPORT and the Kali user. */
export const settingsFill = (s: Settings | undefined) => ({
  attackerIp: s?.attackerIp ?? "",
  kaliUser: s?.kaliUser,
  listenerPort: s?.listenerPort ?? "",
});
