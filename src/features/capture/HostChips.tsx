import type { Host } from "../../types/host";
import { Chip, Select } from "../../ui";

export interface HostChipsProps {
  hosts: Host[];
  linked: string[];
  /** In-scope IPs the user chose to add as new hosts on save. */
  addIps: string[];
  /** In-scope IPs in the paste that aren't hosts yet. */
  unknownIps: string[];
  onLinked: (ids: string[]) => void;
  onAddIps: (ips: string[]) => void;
}

const remove = "ml-0.5 text-muted hover:text-fg cursor-default";

/** Linked hosts as removable chips, `+ ip` chips for unknown in-scope IPs, and a picker. */
export function HostChips({ hosts, linked, addIps, unknownIps, onLinked, onAddIps }: HostChipsProps) {
  const byId = new Map(hosts.map((h) => [h.id, h]));
  const free = hosts.filter((h) => !linked.includes(h.id));
  return (
    <div role="group" aria-label="Hosts" className="flex flex-wrap items-center gap-1.5">
      {linked.map((id) => {
        const h = byId.get(id);
        if (!h) return null;
        return (
          <Chip key={id}>
            <span>{h.name}</span>
            {h.ip && h.ip !== h.name && <span className="font-mono text-muted">{h.ip}</span>}
            <button type="button" aria-label={`Remove ${h.name}`} className={remove} onClick={() => onLinked(linked.filter((x) => x !== id))}>
              ×
            </button>
          </Chip>
        );
      })}
      {addIps.map((ip) => (
        <Chip key={ip} mono title="New host, added on save">
          <span>{ip}</span>
          <span className="font-sans text-muted">new</span>
          <button type="button" aria-label={`Don't add ${ip}`} className={remove} onClick={() => onAddIps(addIps.filter((x) => x !== ip))}>
            ×
          </button>
        </Chip>
      ))}
      {unknownIps.map((ip) => (
        <button
          key={ip}
          type="button"
          onClick={() => onAddIps([...addIps, ip])}
          className="inline-flex h-[18px] items-center rounded-full border border-dashed border-line-strong px-2 font-mono text-[11px] text-muted hover:text-fg cursor-default"
        >
          {`+ ${ip}`}
        </button>
      ))}
      {free.length > 0 && (
        <Select
          aria-label="Link a host"
          placeholder="+ Host"
          value=""
          onValueChange={(id) => id && onLinked([...linked, id])}
          options={free.map((h) => ({ value: h.id, label: h.ip ? `${h.name} · ${h.ip}` : h.name }))}
          className="h-6 w-auto text-xs"
        />
      )}
      {linked.length === 0 && addIps.length === 0 && unknownIps.length === 0 && (
        <span className="text-xs text-faint">No host</span>
      )}
    </div>
  );
}
