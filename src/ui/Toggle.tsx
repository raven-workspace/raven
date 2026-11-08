import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { Kbd } from "./Kbd";

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  on: boolean;
  onChange: (on: boolean) => void;
  /** The shortcut, shown inside the button as an inline key (no cap: the button is already bordered). */
  keys?: string;
}

/** An on/off switch: 28px like the other in-row controls, hairline, accent only while on. */
export function Toggle({ on, onChange, keys, className, children, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx(
        "inline-flex h-7 items-center gap-2 rounded-sm border px-2 text-body cursor-default",
        on ? "border-accent text-accent" : "border-line-2 text-fg-2 hover:text-fg",
        className,
      )}
      {...rest}
    >
      {children}
      {keys && (
        <Kbd variant="inline" aria-hidden>
          {keys}
        </Kbd>
      )}
    </button>
  );
}
