import type { Host } from "../../types/host";
import { Chip, Select } from "../../ui";

export interface HostChipsProps {
  hosts: Host[];
  linked: string[];
  onLinked: (ids: string[]) => void;
}

const remove = "ml-0.5 text-muted hover:text-fg cursor-default";

/** Linked hosts as removable chips, and a picker. */
export function HostChips({ hosts, linked, onLinked }: HostChipsProps) {
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
      {linked.length === 0 && (
        <span className="text-xs text-faint">No host</span>
      )}
    </div>
  );
}
