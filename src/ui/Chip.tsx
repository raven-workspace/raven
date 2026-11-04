import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx";

export type ChipVariant = "default" | "accent";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** `accent` only when it means something: held access, confirmed. */
  variant?: ChipVariant;
  mono?: boolean;
}

const variants: Record<ChipVariant, string> = {
  default: "border-line-strong text-fg-2",
  accent: "border-accent text-accent",
};

export function Chip({ variant = "default", mono, className, ...rest }: ChipProps) {
  return (
    <span
      data-variant={variant}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] leading-4 whitespace-nowrap",
        mono && "font-mono",
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
