import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/** The one wrapping flex: a set of chips that may flow onto several lines. */
export function ChipSet({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("flex flex-wrap gap-2", className)}>{children}</div>;
}
