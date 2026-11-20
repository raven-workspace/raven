import { Select } from "../../../ui/index";
import type { FilledCommand } from "../CommandList/CommandList";
import { usePortPickStore } from "../portPick";
import "./PortChip.scss";

/** The {PORT} chip of a checklist step: a small select of the host's matching open ports, defaulting to the lowest. */
export function PortChip({ commands }: { commands: FilledCommand[] }) {
  const c = commands.find((x) => x.portToken);
  if (!c?.portToken) return null;
  const { key, choices, picked } = c.portToken;
  return (
    <label className="port-chip">
      Port
      <Select
        aria-label="Port"
        className="port-chip__select"
        value={String(picked)}
        onValueChange={(v) => usePortPickStore.getState().set(key, Number(v))}
        options={choices.map((p) => ({ value: String(p), label: String(p) }))}
      />
    </label>
  );
}
