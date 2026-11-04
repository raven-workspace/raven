import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  on: boolean;
  onChange: (on: boolean) => void;
}

/** A small on/off switch: hairline, accent only while on. */
export function Toggle({ on, onChange, className, children, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx(
        "inline-flex h-6 items-center rounded-sm border px-2 text-xs cursor-default",
        on ? "border-accent text-accent" : "border-line-2 text-fg-2 hover:text-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
