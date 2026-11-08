import type { LabelHTMLAttributes } from "react";
import { cx } from "../lib/cx";

/** Small uppercase tracked label. Use `labelClass` for headings in the same style. */
export const labelClass = "text-label uppercase tracking-[0.08em] text-muted";

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...rest }: LabelProps) {
  return <label className={cx(labelClass, "block", className)} {...rest} />;
}
