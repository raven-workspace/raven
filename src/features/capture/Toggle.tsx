import { cx } from "../../lib/cx";
import { Kbd } from "../../ui";

/** An on/off switch with its shortcut, e.g. Private `⌘P`. 28px, like the other in-row controls. */
export function Toggle({ on, keys, onClick, children }: { on: boolean; keys: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "inline-grid h-7 grid-flow-col items-center gap-2 rounded-sm border px-2 text-body cursor-default",
        on ? "border-accent text-accent" : "border-line-2 text-fg-2 hover:text-fg",
      )}
    >
      {children}
      <Kbd variant="inline" aria-hidden>
        {keys}
      </Kbd>
    </button>
  );
}
