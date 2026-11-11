import { X } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { readInterfaces } from "../../engines/facts";
import type { Host } from "../../types/host";
import { Button, IconButton } from "../../ui";
import { useInterfaceDismiss, useInterfaceDismissals, useTunnels } from "../checklist/queries";
import { useHostMutations, useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { TunnelForm } from "./TunnelForm";

/** The facts column is narrow: the sentence takes the first line, the action and Dismiss share the second. */
const ROW = "grid grid-cols-[minmax(0,1fr)_28px] items-center gap-x-2 gap-y-2 border-b border-line py-2 last:border-b-0";

/**
 * Logged `ip a` / `ifconfig` / `ipconfig` output showed a subnet this host reaches and nothing else does yet:
 * offer the tunnel. Accepting marks the host dual-homed first (unless it already is), then opens the tunnel form.
 * Virtual adapters get one quiet line. Renders nothing when there is nothing to say.
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
    <div className="mb-3 grid gap-1" aria-label="Network interfaces" role="region">
      {error && <p role="alert" className="m-0 text-meta text-warn">{error}</p>}
      {suggestions.length > 0 && (
        <ul className="m-0 grid list-none p-0">
          {suggestions.map((s) => (
            <li key={s.key} className={ROW}>
              <p className="col-span-2 m-0 min-w-0 text-body text-fg">
                {s.iface} {s.ip}/{s.prefix} reaches{" "}
                <span className="whitespace-nowrap"><button
                  type="button"
                  onClick={() => onOpenEntry?.(s.entryId)}
                  disabled={!onOpenEntry}
                  title="Open the logged command"
                  className="cursor-default border-0 bg-transparent p-0 font-mono text-code text-fg underline decoration-line-strong underline-offset-4 enabled:hover:decoration-fg disabled:no-underline"
                >
                  {s.subnet}
                </button>.</span>
              </p>
              <Button size="sm" className="justify-self-start" onClick={() => accept(s.key, s.subnet)}>
                {host.dualHomed ? "Add tunnel" : "Mark dual-homed and add tunnel"}
              </Button>
              <IconButton
                icon={X}
                label={`Dismiss ${s.subnet} on ${host.name}`}
                onClick={() => act(s.key, (settled) => dismiss.mutate({ hostId: host.id, subnet: s.subnet }, { onError: (e) => setError(e.message), onSettled: settled }))}
              />
            </li>
          ))}
        </ul>
      )}
      {reading.alsoSeen.length > 0 && (
        <p className="m-0 grid grid-flow-col items-center justify-start gap-x-2 text-meta text-muted">
          <span>Also seen:</span>
          {reading.alsoSeen.map((a, i) => (
            <span key={a.subnet} className={i === 0 ? "" : "border-l border-line-strong pl-2"}>{a.iface} {a.ip}/{a.prefix} (virtual)</span>
          ))}
        </p>
      )}
      {adding && hosts.data && (
        <TunnelForm engagementId={engagementId} hosts={hosts.data} initial={{ viaHostId: host.id, subnets: [adding] }} onClose={() => setAdding(null)} />
      )}
    </div>
  );
}
