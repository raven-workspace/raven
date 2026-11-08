import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx";

export type KbdProps = HTMLAttributes<HTMLElement> & {
  /** `cap` is a bordered key cap; `inline` drops border and fill for use inside bordered buttons. */
  variant?: "cap" | "inline";
};

export function Kbd({ className, variant = "cap", ...rest }: KbdProps) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] px-1 font-mono text-label font-normal leading-none",
        variant === "cap"
          ? "border border-line-strong bg-surface text-fg-2"
          : "text-muted",
        className,
      )}
      {...rest}
    />
  );
}
