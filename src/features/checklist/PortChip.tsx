import { Select } from "../../ui";
import type { FilledCommand } from "./CommandList";
import { usePortPickStore } from "./portPick";

/** The {PORT} chip of a checklist step: a small select of the host's matching open ports, defaulting to the lowest. */
export function PortChip({ commands }: { commands: FilledCommand[] }) {
  const c = commands.find((x) => x.portToken);
  if (!c?.portToken) return null;
  const { key, choices, picked } = c.portToken;
  return (
    <label className="flex items-center gap-1.5 self-start text-xs text-muted">
      PORT
      <Select
        aria-label="Port"
        className="h-7 w-24"
        value={String(picked)}
        onValueChange={(v) => usePortPickStore.getState().set(key, Number(v))}
        options={choices.map((p) => ({ value: String(p), label: String(p) }))}
      />
    </label>
  );
}
