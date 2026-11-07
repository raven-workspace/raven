import type { Host } from "../../types/host";

export type HostPhase = "before" | "after";

/** Phase follows what the user has (access), never the board column. */
export function phaseOf(host: Pick<Host, "access">): HostPhase {
  return host.access === "none" ? "before" : "after";
}
