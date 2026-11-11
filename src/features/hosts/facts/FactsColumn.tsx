import type { ReactNode } from "react";
import { phaseOf } from "../../../engines/facts";
import { isFreeKey, useKeydown } from "../../../lib/keys";
import type { Host } from "../../../types/host";
import { InterfaceNudge } from "../../network/InterfaceNudge";
import { useLog } from "../../log/queries";
import { CoverageFacts } from "./CoverageFacts";
import { HostCredentialsFacts } from "./HostCredentialsFacts";
import { IdentityFacts, OtherAccountsFacts } from "./IdentityFacts";
import { ServicesFacts } from "./ServicesFacts";
import { useFactFolds, type FactGroupId } from "./useFactFolds";
import { VectorsFacts } from "./VectorsFacts";

const BEFORE: FactGroupId[] = ["coverage", "services", "credentials"];
const AFTER: FactGroupId[] = ["identity", "vectors", "accounts"];

/**
 * What's known about the host, ordered by phase: the host's access decides it, never its board column. The current
 * phase's groups come first and open; the others fold to one summary line each. Stacked (narrow windows), every
 * group starts folded. `S` toggles Services from anywhere on the page.
 */
export function FactsColumn({ engagementId, host, variant, onOpenEntry }: {
  engagementId: string;
  host: Host;
  variant: "column" | "stacked";
  /** Opens a proof entry (a credential result, the identity's source) in the Log. */
  onOpenEntry?: (entryId: string) => void;
}) {
  const phase = phaseOf(host);
  const current = phase === "before" ? BEFORE : AFTER;
  const folds = useFactFolds(host.id, (g) => variant === "column" && current.includes(g));
  const log = useLog(engagementId);
  const entries = (log.data ?? []).filter((e) => e.hostIds.includes(host.id));

  useKeydown((e) => {
    if (!isFreeKey(e) || (e.key !== "s" && e.key !== "S")) return;
    e.preventDefault();
    folds.toggle("services");
  });

  const props = (g: FactGroupId) => ({ open: folds.isOpen(g), onToggle: () => folds.toggle(g) });
  const groups: Record<FactGroupId, ReactNode> = {
    coverage: <CoverageFacts key="coverage" engagementId={engagementId} host={host} {...props("coverage")} />,
    services: <ServicesFacts key="services" engagementId={engagementId} hostId={host.id} entries={entries} {...props("services")} />,
    credentials: <HostCredentialsFacts key="credentials" engagementId={engagementId} host={host} onOpenEntry={onOpenEntry} {...props("credentials")} />,
    identity: <IdentityFacts key="identity" engagementId={engagementId} host={host} onOpenEntry={onOpenEntry} {...props("identity")} />,
    vectors: <VectorsFacts key="vectors" engagementId={engagementId} host={host} {...props("vectors")} />,
    accounts: <OtherAccountsFacts key="accounts" engagementId={engagementId} host={host} {...props("accounts")} />,
  };
  // After a foothold the earlier groups follow in the order they mattered: Services, Coverage, Credentials.
  const order: FactGroupId[] = phase === "before" ? [...BEFORE, ...AFTER] : [...AFTER, "services", "coverage", "credentials"];

  return (
    <div aria-label="Facts" role="region" className="grid">
      <InterfaceNudge engagementId={engagementId} host={host} onOpenEntry={onOpenEntry} />
      {order.map((g) => groups[g])}
    </div>
  );
}
