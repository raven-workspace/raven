import type { Host } from "../../../types/host";
import { X } from "@phosphor-icons/react";
import { Chip, ChipSet, IconButton, Select } from "../../../ui/index";
import { HostsLoadError } from "../../arsenal/HostChip/HostChip";
import type { HostsError } from "../../commands/fillData";
import "./HostChips.scss";

export interface HostChipsProps {
  hosts: Host[];
  linked: string[];
  onLinked: (ids: string[]) => void;
  /** The hosts failed to load: say so and offer a retry, not "No host". */
  loadError?: HostsError | null;
}

/** Linked hosts as removable chips, and a picker. */
export function HostChips({ hosts, linked, onLinked, loadError }: HostChipsProps) {
  if (loadError) return <HostsLoadError error={loadError} className="host-chips" />;
  const byId = new Map(hosts.map((h) => [h.id, h]));
  const free = hosts.filter((h) => !linked.includes(h.id));
  return (
    <ChipSet role="group" aria-label="Hosts" className="host-chips">
      {linked.map((id) => {
        const h = byId.get(id);
        if (!h) return null;
        return (
          // The remove button sits beside the chip, not inside it: a 28px target never fits a 22px chip.
          <span key={id} className="host-chips__item">
            <Chip>
              <span>{h.name}</span>
              {h.ip && h.ip !== h.name && <span className="host-chips__ip">{h.ip}</span>}
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
          className="host-chips__picker"
        />
      )}
      {linked.length === 0 && (
        <span className="host-chips__empty">No host</span>
      )}
    </ChipSet>
  );
}
