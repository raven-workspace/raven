import type { Host } from "../../types/host";
import { X } from "@phosphor-icons/react";
import { Chip, ChipSet, IconButton, Select } from "../../ui";

export interface HostChipsProps {
  hosts: Host[];
  linked: string[];
  onLinked: (ids: string[]) => void;
}

/** Linked hosts as removable chips, and a picker. */
export function HostChips({ hosts, linked, onLinked }: HostChipsProps) {
  const byId = new Map(hosts.map((h) => [h.id, h]));
  const free = hosts.filter((h) => !linked.includes(h.id));
  return (
    <ChipSet role="group" aria-label="Hosts" className="items-center">
      {linked.map((id) => {
        const h = byId.get(id);
        if (!h) return null;
        return (
          // The remove button sits beside the chip, not inside it: a 28px target never fits a 22px chip.
          <span key={id} className="grid grid-flow-col items-center">
            <Chip>
              <span>{h.name}</span>
              {h.ip && h.ip !== h.name && <span className="font-mono text-muted">{h.ip}</span>}
            </Chip>
            <IconButton icon={X} label={`Remove ${h.name}`} onClick={() => onLinked(linked.filter((x) => x !== id))} />
          </span>
        );
      })}
      {free.length > 0 && (
        <Select
          aria-label="Link a host"
          placeholder="+ Host"
          value=""
          onValueChange={(id) => id && onLinked([...linked, id])}
          options={free.map((h) => ({ value: h.id, label: h.ip ? `${h.name} (${h.ip})` : h.name }))}
          className="h-7 w-auto"
        />
      )}
      {linked.length === 0 && (
        <span className="text-meta text-faint">No host</span>
      )}
    </ChipSet>
  );
}
