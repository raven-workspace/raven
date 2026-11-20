import { PlusIcon, X } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { readInterfaces } from "../../engines/facts";
import type { Host } from "../../types/host";
import { cx } from "../../lib/cx";
import { Button, IconButton, labelClass } from "../../ui";
import { useInterfaceDismiss, useInterfaceDismissals, useTunnels } from "./queries";
import { useHostMutations, useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { TunnelForm } from "./TunnelForm";
import "./InterfaceNudge.scss";

/**
 * Logged `ip a` / `ifconfig` / `ipconfig` output showed a subnet this host reaches and nothing else does yet:
 * offer the tunnel. Accepting marks the host dual-homed first (unless it already is), then opens the tunnel form.
 * Virtual adapters get one quiet line. It is a group like the fact groups below it (label over a hairline, actions
 * at their weight), not foldable. Renders nothing when there is nothing to say.
 */
export function InterfaceNudge({ engagementId, host, onOpenEntry }: {
  engagementId: string;
  host: Host;
  onOpenEntry?: (entryId: string) => void;
}) {
  const log = useLog(engagementId);
  const { tunnels } = useTunnels(engagementId);
  const { dismissals } = useInterfaceDismissals(engagementId);
  const dismiss = useInterfaceDismiss(engagementId);
  const hosts = useHosts(engagementId);
  const { update } = useHostMutations(engagementId);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  // Subnets with a mutation in flight: hidden at once, and a second click on them does nothing.
  const flying = useRef(new Set<string>());
  const [flyingKeys, setFlyingKeys] = useState<ReadonlySet<string>>(new Set());

  const reading = useMemo(() => readInterfaces(log.data ?? [], host, tunnels, dismissals), [log.data, host, tunnels, dismissals]);
  const suggestions = reading.suggestions.filter((s) => !flyingKeys.has(s.key));

  const act = (key: string, run: (settled: () => void) => void) => {
    if (flying.current.has(key)) return;
    setError(undefined);
    flying.current.add(key);
    setFlyingKeys(new Set(flying.current));
    run(() => {
      flying.current.delete(key);
      setFlyingKeys(new Set(flying.current));
    });
  };
  const accept = (key: string, subnet: string) => {
    if (host.dualHomed) return setAdding(subnet);
    act(key, (settled) =>
      update.mutate(
        { id: host.id, input: { name: host.name, ip: host.ip, os: host.os, access: host.access, dualHomed: true } },
        { onSuccess: () => setAdding(subnet), onError: (e) => setError(e.message), onSettled: settled },
      ),
    );
  };

  if (suggestions.length === 0 && reading.alsoSeen.length === 0 && !adding) return null;

  return (
    <section aria-label="Network interfaces" className="interface-nudge">
      <header className="interface-nudge__header">
        <h2 className={cx(labelClass, "interface-nudge__title")}>Interfaces</h2>
      </header>
      {error && <p role="alert" className="interface-nudge__error">{error}</p>}
      {suggestions.length > 0 && (
        <ul className="interface-nudge__list">
          {suggestions.map((s) => (
            <li key={s.key} className="interface-nudge__item">
              <p className="interface-nudge__text">
                {s.iface} {s.ip}/{s.prefix} reaches{" "}
                <span className="interface-nudge__nowrap"><button
                  type="button"
                  onClick={() => onOpenEntry?.(s.entryId)}
                  disabled={!onOpenEntry}
                  title="Open the logged command"
                  className="interface-nudge__subnet"
                >
                  {s.subnet}
                </button>.</span>
              </p>
              <IconButton
                icon={X}
                label={`Dismiss ${s.subnet} on ${host.name}`}
                onClick={() => act(s.key, (settled) => dismiss.mutate({ hostId: host.id, subnet: s.subnet }, { onError: (e) => setError(e.message), onSettled: settled }))}
              />
              <Button size="sm" className="interface-nudge__accept" onClick={() => accept(s.key, s.subnet)}>
                <PlusIcon size={16} weight="regular" aria-hidden /> {host.dualHomed ? "Add tunnel" : "Mark dual-homed and add tunnel"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {reading.alsoSeen.length > 0 && (
        <p className="interface-nudge__also">
          <span>Also seen:</span>
          {reading.alsoSeen.map((a, i) => (
            <span key={a.subnet} className={i === 0 ? undefined : "interface-nudge__also-item"}>{a.iface} {a.ip}/{a.prefix} (virtual)</span>
          ))}
        </p>
      )}
      {adding && hosts.data && (
        <TunnelForm engagementId={engagementId} hosts={hosts.data} initial={{ viaHostId: host.id, subnets: [adding] }} onClose={() => setAdding(null)} />
      )}
    </section>
  );
}
