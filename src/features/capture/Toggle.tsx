import { cx } from "../../lib/cx";
import { Kbd } from "../../ui";

/** An on/off switch with its shortcut, e.g. Private `⌘P`. */
export function Toggle({ on, keys, onClick, children }: { on: boolean; keys: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-xs cursor-default",
        on ? "border-accent text-accent" : "border-line-2 text-fg-2 hover:text-fg",
      )}
    >
      {children}
      <Kbd aria-hidden className="h-[15px] text-[9.5px]">
        {keys}
      </Kbd>
    </button>
  );
}
