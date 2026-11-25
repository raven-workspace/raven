import type { CredAttempt, Credential } from "../../types/credentials";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { Hop } from "../../types/network";
import type { Service } from "../../types/service";
import { domainAdminConfirmed } from "../checklist/daCover";
import { adSetHosts, findDc } from "../checklist/facts";
import type { PlaybookId } from "../checklist/types";
import { hostSprayServices, isSprayable } from "./matrix";
import { isReuseAttempt } from "./reuse";

const isDomainCred = (c: Credential): boolean => c.scope === "domain";
const hasAccess = (a: CredAttempt): boolean => a.result === "valid" || a.result === "admin";

/**
 * Which AD playbooks are open. Every record belongs to one engagement, so credentials, attempts and hops are
 * filtered on `engagementId`; a caller that already scoped them loses nothing.
 */
export function playbookTriggers(input: {
  engagement: Pick<Engagement, "id">;
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  credentials: Credential[];
  attempts: CredAttempt[];
  hops: Hop[];
}): Record<PlaybookId, boolean> & { lateral: boolean } {
  const { engagement, hosts, servicesByHost } = input;
  const mine = input.attempts.filter((a) => a.engagementId === engagement.id);
  const domainIds = new Set(
    input.credentials.filter((c) => c.engagementId === engagement.id && isDomainCred(c)).map((c) => c.id),
  );
  const domainWorks = mine.some((a) => hasAccess(a) && a.authMode === "domain" && domainIds.has(a.credId));
  const dc = findDc(hosts, servicesByHost);
  const daByAttempt = domainAdminConfirmed(hosts, servicesByHost, mine);
  const daByHop = !!dc && input.hops.some((h) => h.engagementId === engagement.id && h.toHostId === dc.id);
  // Lateral movement: a host reaches another network, or a usable credential has not been tried on a host with something to try it on.
  const untried = input.credentials.some(
    (c) =>
      c.engagementId === engagement.id &&
      isSprayable(c) &&
      hosts.some(
        (h) => hostSprayServices(h, servicesByHost.get(h.id) ?? []).length > 0 && !mine.some((a) => a.credId === c.id && a.hostId === h.id),
      ),
  );
  return {
    lateral: hosts.some((h) => h.dualHomed === true) || untried,
    nocreds: adSetHosts(hosts).length > 0 && !domainWorks,
    user: domainWorks,
    da: daByAttempt || daByHop,
  };
}

/** Domain credentials created after the goal was completed (the "new credential since" flag). */
export function newCredSince(goalCompletedAt: number | undefined, credentials: Credential[]): Credential[] {
  if (goalCompletedAt === undefined || Number.isNaN(goalCompletedAt)) return [];
  return credentials.filter((c) => isDomainCred(c) && c.createdAt > goalCompletedAt);
}

export interface AccessFlag {
  hostId: string;
  credId?: string;
  usernameId?: string;
  service: string;
  result: "admin" | "valid";
  at: number;
  /** Password reuse found in a dump, not a result on `service`. */
  reuse?: true;
}

/**
 * Hosts with a valid/admin attempt newer than their `accessReviewedAt`. One flag per host, subject and
 * service, keeping the strongest result and its latest time. Derived, never stored. An attempt on a bare
 * username counts; one on a credential counts only when that credential is among `credentials`.
 */
export function accessFlags(input: { hosts: Host[]; attempts: CredAttempt[]; credentials: Credential[] }): AccessFlag[] {
  const flags = new Map<string, AccessFlag>();
  for (const host of input.hosts) {
    const reviewed = host.accessReviewedAt ?? -Infinity;
    // Records of another engagement never flag this host.
    const known = new Set(input.credentials.filter((c) => c.engagementId === host.engagementId).map((c) => c.id));
    for (const a of input.attempts) {
      if (a.hostId !== host.id || a.engagementId !== host.engagementId || !hasAccess(a) || !(a.at > reviewed)) continue;
      if (!a.usernameId && !known.has(a.credId)) continue;
      const key = [host.id, a.usernameId ?? a.credId, a.service].join("\u0000");
      const prev = flags.get(key);
      const result = a.result as "admin" | "valid";
      const stronger = !prev || (result === "admin" && prev.result !== "admin");
      const newer = !!prev && result === prev.result && a.at > prev.at;
      if (stronger || newer) {
        flags.set(key, {
          hostId: host.id,
          ...(a.credId ? { credId: a.credId } : {}),
          ...(a.usernameId ? { usernameId: a.usernameId } : {}),
          service: a.service,
          result,
          at: a.at,
          ...(isReuseAttempt(a) ? { reuse: true as const } : {}),
        });
      }
    }
  }
  return [...flags.values()].sort((x, y) => x.at - y.at);
}
