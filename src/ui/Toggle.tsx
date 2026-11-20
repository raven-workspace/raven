import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { Kbd } from "./Kbd";
import "./Toggle.scss";

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
      className={cx("toggle", className)}
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
