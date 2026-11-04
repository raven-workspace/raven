import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx";

export type KbdProps = HTMLAttributes<HTMLElement>;

export function Kbd({ className, ...rest }: KbdProps) {
  return (
    <kbd
      className={cx(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-2 bg-surface px-1 font-mono text-[10.5px] leading-none text-muted-2",
        className,
      )}
      {...rest}
    />
  );
}
