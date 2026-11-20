import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import "./layout.scss";

/** Single-line run of controls. Never wraps. */
export function Toolbar({ gap = 2, className, children }: { gap?: 2 | 3; className?: string; children: ReactNode }) {
  return <div className={cx("toolbar", gap === 3 && "toolbar--loose", className)}>{children}</div>;
}
