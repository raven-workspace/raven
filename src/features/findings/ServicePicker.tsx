import { foldServices, serviceIdentity, sortServices } from "../../engines/facts";
import { cx } from "../../lib/cx";
import { shortHostName } from "../../lib/hostName";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { labelClass } from "../../ui";
import { hostLabel } from "../credentials/AccessGrants";
import { FoldedRows } from "../hosts/facts/ServicesFacts";

// The services grid of the Facts column (port, identity), with a checkbox track in front.
const GRID = "grid grid-cols-[auto_6ch_minmax(0,1fr)] gap-x-2";
const ROW = "col-span-3 grid grid-cols-subgrid items-baseline border-b border-line";

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

function PickRow({ s, on, onChange }: { s: Service; on: boolean; onChange: () => void }) {
  const id = serviceIdentity(s);
  const guess = [s.nmapService, s.nmapVersion].filter(Boolean).join(" ");
  return (
    <li className={ROW}>
      <label className="col-span-3 grid cursor-default grid-cols-subgrid items-baseline py-1 hover:bg-surface">
        <input
          type="checkbox"
          checked={on}
          onChange={onChange}
          aria-label={`${s.port}/${s.protocol} ${id.label || "unidentified"}`}
          className="self-center accent-[var(--color-accent)]"
        />
        <span className="font-mono text-xs text-fg-2">
          {s.port}
          {s.protocol === "udp" && <span className="text-faint">u</span>}
        </span>
        <span className="min-w-0 truncate text-[13px]">
          {id.confirmed ? (
            <span className="text-fg" title={guess ? `nmap: ${guess}` : undefined}>
              {id.label} <span className="text-accent">✓</span>
            </span>
          ) : (
            <span className="text-muted">
              {id.label}
              {id.unidentified && <span className="text-warn">{id.label ? " ?" : "?"}</span>}
            </span>
          )}
          {s.state !== "open" && <span className="ml-1.5 font-mono text-[11px] text-muted-2">{s.state}</span>}
        </span>
      </label>
    </li>
  );
}

/**
 * Affected services, offered from the finding's hosts only: the same identity (confirmed beats nmap's guess),
 * sort and folding as the Facts column's services, one checkbox per row.
 */
export function ServicePicker({ hosts, servicesByHost, error, value, onChange }: {
  /** The finding's affected hosts, in order. */
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  /** The services failed to load. */
  error?: string;
  value: string[];
  onChange: (serviceIds: string[]) => void;
}) {
  const row = (s: Service) => (
    <PickRow key={s.id} s={s} on={value.includes(s.id)} onChange={() => onChange(toggle(value, s.id))} />
  );
  const withServices = hosts.filter((h) => (servicesByHost.get(h.id) ?? []).length > 0);

  return (
    <div role="group" aria-label="Affected services" className="flex flex-col gap-1.5">
      <span className={labelClass}>Affected services</span>
      {error ? (
        <p role="alert" className="m-0 text-xs text-warn">Couldn't load services: {error}</p>
      ) : hosts.length === 0 ? (
        <span className="text-xs text-muted">Pick an affected host to choose its services.</span>
      ) : withServices.length === 0 ? (
        <span className="text-xs text-muted">No services on {hosts.length === 1 ? "this host" : "these hosts"} yet.</span>
      ) : (
        // Its own scroll past ~10 rows, so a host with many ports doesn't push the rest of the form away.
        <div className="flex max-h-[17rem] flex-col gap-2 overflow-y-auto pr-1">
          {withServices.map((h) => {
            const { rows, rpc, udp } = foldServices(servicesByHost.get(h.id) ?? []);
            const has = (list: Service[]) => list.some((s) => value.includes(s.id));
            return (
              <div key={h.id} className="flex flex-col gap-0.5">
                {hosts.length > 1 && <span title={hostLabel(h)} className="text-xs text-fg-2">{shortHostName(hostLabel(h))}</span>}
                <ul className={cx(GRID, "m-0 list-none p-0")}>
                  {sortServices(rows).map(row)}
                  <FoldedRows label={`msrpc ×${rpc.length}`} services={rpc} defaultOpen={has(rpc)} render={row} />
                  <FoldedRows label={`${udp.length} UDP`} services={udp} defaultOpen={has(udp)} render={row} />
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
