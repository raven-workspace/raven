import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx";
import "./Chip.scss";

/** `accent` only when it means something (held access, confirmed); `warn` for dead, locked or errored. */
export type ChipVariant = "default" | "accent" | "warn";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
  mono?: boolean;
}

export function Chip({ variant = "default", mono, className, ...rest }: ChipProps) {
  return (
    <span
      data-variant={variant}
      className={cx("chip", variant !== "default" && `chip--${variant}`, mono && "chip--mono", className)}
      {...rest}
    />
  );
}
