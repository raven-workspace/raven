import { ariaKeys, keyLabel, SHORTCUTS } from "../../../lib/shortcuts";
import type { LogKind } from "../../../types/log";
import { Kbd } from "../../../ui/index";
import { ToggleGroup, ToggleGroupItem } from "../../../ui/shadcn/toggle-group";
import { KINDS } from "../resolve";
import "./KindChips.scss";

/** The five kinds as one segmented control; the detected or chosen one is in the accent colour. ⌘1–⌘5 (Ctrl+1–5 on Linux) switch. */
export function KindChips({ kind, onChange }: { kind: LogKind; onChange: (k: LogKind) => void }) {
  return (
    <ToggleGroup
      type="single"
      aria-label="Kind"
      value={kind}
      // Re-clicking the chosen kind would clear it; the kind always has a value.
      onValueChange={(v) => v && onChange(v as LogKind)}
    >
      {KINDS.map((k, i) => (
        <ToggleGroupItem key={k.kind} value={k.kind} aria-keyshortcuts={ariaKeys(SHORTCUTS.captureKinds[i]!)} className="kind-chips__item">
          {k.label}
          <Kbd variant="inline" aria-hidden>
            {keyLabel(SHORTCUTS.captureKinds[i]!)}
          </Kbd>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
