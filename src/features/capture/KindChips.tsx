import type { LogKind } from "../../types/log";
import { Kbd } from "../../ui";
import { ToggleGroup, ToggleGroupItem } from "../../ui/shadcn/toggle-group";
import { KINDS } from "./resolve";

/** The five kinds as one segmented control; the detected or chosen one is in the accent colour. `⌘1`–`⌘5` switch. */
export function KindChips({ kind, onChange }: { kind: LogKind; onChange: (k: LogKind) => void }) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      aria-label="Kind"
      value={kind}
      // Re-clicking the chosen kind would clear it; the kind always has a value.
      onValueChange={(v) => v && onChange(v as LogKind)}
    >
      {KINDS.map((k, i) => (
        <ToggleGroupItem key={k.kind} value={k.kind} aria-keyshortcuts={`Meta+${i + 1}`} className="gap-2 text-body">
          {k.label}
          <Kbd variant="inline" aria-hidden>
            {`⌘${i + 1}`}
          </Kbd>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
