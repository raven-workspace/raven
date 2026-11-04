import { cx } from "../../lib/cx";
import type { LogKind } from "../../types/log";
import { Kbd } from "../../ui";
import { KINDS } from "./resolve";

/** The five kinds; the detected or chosen one is in the accent colour. `⌘1`–`⌘5` switch. */
export function KindChips({ kind, onChange }: { kind: LogKind; onChange: (k: LogKind) => void }) {
  return (
    <div role="group" aria-label="Kind" className="flex flex-wrap items-center gap-1.5">
      {KINDS.map((k, i) => {
        const active = k.kind === kind;
        return (
          <button
            key={k.kind}
            type="button"
            aria-pressed={active}
            aria-keyshortcuts={`Meta+${i + 1}`}
            onClick={() => onChange(k.kind)}
            className={cx(
              "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs cursor-default",
              active ? "border-accent text-accent" : "border-line-2 text-fg-2 hover:border-line-strong hover:text-fg",
            )}
          >
            {k.label}
            <Kbd aria-hidden className="h-[15px] min-w-[15px] text-[9.5px]">
              {`⌘${i + 1}`}
            </Kbd>
          </button>
        );
      })}
    </div>
  );
}
