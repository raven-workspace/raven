import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx";
import "./Kbd.scss";

export type KbdProps = HTMLAttributes<HTMLElement> & {
  /** `cap` is a bordered key cap; `inline` drops border and fill for use inside bordered buttons. */
  variant?: "cap" | "inline";
};

export function Kbd({ className, variant = "cap", ...rest }: KbdProps) {
  return (
    <kbd
      className={cx("kbd", variant === "cap" ? "kbd--cap" : "kbd--inline", className)}
      {...rest}
    />
  );
}
