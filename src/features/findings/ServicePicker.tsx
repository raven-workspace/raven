import { foldServices, serviceIdentity, sortServices } from "../../engines/facts";
import { SCROLL_PANE } from "../../ui/controlStyles";
import { shortHostName, hostLabel } from "../../lib/hostName";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { fieldLabelClass } from "../../ui";
import { FoldedRows } from "../hosts/facts/ServicesFacts";
import "./ServicePicker.scss";

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

function PickRow({ s, on, onChange }: { s: Service; on: boolean; onChange: () => void }) {
  const id = serviceIdentity(s);
  const guess = [s.nmapService, s.nmapVersion].filter(Boolean).join(" ");
  return (
    <li className="service-picker__row">
      <label className="service-picker__pick">
        <input
          type="checkbox"
          checked={on}
          onChange={onChange}
          aria-label={`${s.port}/${s.protocol} ${id.label || "unidentified"}`}
          className="service-picker__check"
        />
        <span className="service-picker__port">
          {s.port}
          {s.protocol === "udp" && <span className="service-picker__udp">u</span>}
        </span>
        <span className="service-picker__identity">
          {id.confirmed ? (
            <span className="service-picker__confirmed" title={guess ? `nmap: ${guess}` : undefined}>
              {id.label} <span className="service-picker__tick">✓</span>
            </span>
          ) : (
            <span className="service-picker__guess">
              {id.label}
              {id.unidentified && <span className="service-picker__unknown">{id.label ? " ?" : "?"}</span>}
            </span>
          )}
          {s.state !== "open" && <span className="service-picker__state">{s.state}</span>}
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
    <div role="group" aria-label="Affected services" className="service-picker">
      <span className={fieldLabelClass}>Affected services</span>
      {error ? (
        <p role="alert" className="service-picker__error">Couldn't load services: {error}</p>
      ) : hosts.length === 0 ? (
        <span className="service-picker__hint">Pick an affected host to choose its services.</span>
      ) : withServices.length === 0 ? (
        <span className="service-picker__hint">No services on {hosts.length === 1 ? "this host" : "these hosts"} yet.</span>
      ) : (
        // Its own scroll past ~10 rows, so a host with many ports doesn't push the rest of the form away. It is a scroll
        // pane of its own, so it pads like one (SCROLL_PANE): the editor pane's padding can't keep this list's overlay
        // scrollbar off its rows or leave room for a row's focus ring (audit: "scroll panes never clip focus").
        <div data-testid="service-list" className={`service-picker__list ${SCROLL_PANE}`}>
          {withServices.map((h) => {
            const { rows, rpc, udp } = foldServices(servicesByHost.get(h.id) ?? []);
            const has = (list: Service[]) => list.some((s) => value.includes(s.id));
            return (
              <div key={h.id} className="service-picker__host">
                {hosts.length > 1 && <span title={hostLabel(h)} className="service-picker__host-name">{shortHostName(hostLabel(h))}</span>}
                <ul className="service-picker__grid">
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
