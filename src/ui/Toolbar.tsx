import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/** Single-line run of controls. Never wraps. */
export function Toolbar({ gap = 2, className, children }: { gap?: 2 | 3; className?: string; children: ReactNode }) {
  return <div className={cx("inline-flex items-center flex-nowrap", gap === 2 ? "gap-2" : "gap-3", className)}>{children}</div>;
}
