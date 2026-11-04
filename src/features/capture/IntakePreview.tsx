import { formatIntakeSummary, pendingCredentialLabel, unrecordedLabel, type CredentialIntakePlan } from "../../engines/credentials";
import type { Host } from "../../types/host";
import { Toggle } from "../../ui";
import { isAccepted } from "./resolve";

/** What saving an nxc paste will record, with a toggle per credential it would add. Nothing is written until Save. */
export function IntakePreview({ plan, hosts, toggles, onToggle }: {
  plan: CredentialIntakePlan;
  hosts: Host[];
  toggles: Record<string, boolean>;
  onToggle: (key: string, on: boolean) => void;
}) {
  return (
    <section aria-label="Credentials from this output" className="flex flex-col gap-1.5">
      <p className="m-0 font-mono text-xs text-muted">{formatIntakeSummary(plan)}</p>
      {plan.newCredentials.length > 0 && (
        <div role="group" aria-label="New credentials" className="flex flex-wrap gap-1.5">
          {plan.newCredentials.map((p) => (
            <Toggle key={p.key} on={isAccepted(p, toggles)} onChange={(on) => onToggle(p.key, on)} className="font-mono">
              Add {p.failedOnly ? unrecordedLabel(p, hosts) : pendingCredentialLabel(p)}
            </Toggle>
          ))}
        </div>
      )}
      {plan.unknownHosts.length > 0 && (
        <p className="m-0 text-xs text-muted">
          Not recorded: {plan.unknownHosts.join(", ")} {plan.unknownHosts.length === 1 ? "isn't a host" : "aren't hosts"} in this
          engagement.
        </p>
      )}
      {plan.ipChanges.map((c) => (
        <p key={`${c.hostId}-${c.to}`} className="m-0 text-xs text-muted">
          {c.hostName} answered on {c.to} (Raven has {c.from || "no IP"}); its results go to {c.hostName}.
        </p>
      ))}
    </section>
  );
}
