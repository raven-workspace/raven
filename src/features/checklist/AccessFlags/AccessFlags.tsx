import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { accessFlags } from "../../../engines/credentials/state";
import { credLabel, usernameLabel } from "../../../engines/credentials/labels";
import { api } from "../../../lib/api";
import { storeChanged } from "../../../lib/storeChange";
import type { CredAttempt, Credential } from "../../../types/credentials";
import type { Host } from "../../../types/host";
import { Button, labelClass } from "../../../ui/index";
import { useUsernames } from "../../credentials/queries";
import "./AccessFlags.scss";

/** Hosts with valid or admin access newer than their last review, each with a Reviewed button. */
export function AccessFlags({ engagementId, hosts, attempts, credentials }: { engagementId: string; hosts: Host[]; attempts: CredAttempt[]; credentials: Credential[] }) {
  const qc = useQueryClient();
  const flags = useMemo(() => accessFlags({ hosts, attempts, credentials }), [hosts, attempts, credentials]);
  // Bare-username access is named from the username list, read only when a flag needs it.
  const usernames = useUsernames(engagementId, { enabled: flags.some((f) => f.usernameId) }).data ?? [];
  const reviewed = useMutation({
    mutationFn: (hostId: string) => api.hostMarkAccessReviewed(hostId),
    onSuccess: (_h, hostId) => void storeChanged(qc, { entity: "host", id: hostId, change: "updated" }),
  });
  if (flags.length === 0) return null;
  const who = (f: (typeof flags)[number]) => {
    // A bare-username attempt also carries the secret's credential: the username is who got in.
    if (f.usernameId) {
      const u = usernames.find((x) => x.id === f.usernameId);
      return u ? usernameLabel(u) : "unknown";
    }
    const c = credentials.find((x) => x.id === f.credId);
    return c ? credLabel(c) : "unknown";
  };
  return (
    <section aria-label="New access" className="access-flags">
      <h3 className={labelClass}>New access</h3>
      <ul className="access-flags__list">
        {flags.map((f) => {
          const host = hosts.find((h) => h.id === f.hostId);
          return (
            <li key={`${f.hostId}-${f.credId ?? f.usernameId}-${f.service}`} className="access-flags__item">
              <span className="access-flags__text">{`${host?.name ?? "unknown host"}: ${f.result} over ${f.service} as ${who(f)}`}</span>
              <Button size="sm" disabled={reviewed.isPending} onClick={() => reviewed.mutate(f.hostId)}>
                Reviewed
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
