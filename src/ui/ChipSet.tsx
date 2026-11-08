import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/** The one wrapping flex: a set of chips (or legend units) that may flow onto several lines. */
export function ChipSet({
  className,
  gap = 2,
  as: Tag = "div",
  children,
  ...rest
}: {
  className?: string;
  /** 2 = 8px, 6 = 24px between units. */
  gap?: 2 | 6;
  as?: "div" | "ul";
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag className={cx("flex flex-wrap", gap === 6 ? "gap-x-6 gap-y-2" : "gap-2", className)} {...rest}>
      {children}
    </Tag>
  );
}
