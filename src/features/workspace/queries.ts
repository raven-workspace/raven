import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export const tun0Key = ["tun0"] as const;

/** How often the status bar asks for tun0's address: a VPN that comes up or drops shows within this. */
const TUN0_POLL_MS = 15_000;

/** tun0's IPv4 address, or null with no tun0 (no VPN up). A failed read counts as no tun0: the LHOST cell stays as it is. */
export function useTun0() {
  return useQuery({
    queryKey: tun0Key,
    queryFn: () => api.tun0Address().catch(() => null),
    refetchInterval: TUN0_POLL_MS,
  });
}

/**
 * Raven terminal sessions with a listening socket open (design §1.5, FR-17). Always 0 until the terminal lands: the
 * session data (Rust checks each session's process tree) plugs in here.
 */
export function useListenerCount(engagementId: string): number {
  void engagementId;
  return 0;
}
