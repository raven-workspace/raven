import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import { labelClass } from "./Label";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Small uppercase heading, like the mockup's card h5. */
  title?: ReactNode;
  /** Right-aligned controls in the heading row. */
  actions?: ReactNode;
}

/** Flat hairline box on black. No fill, no shadow. */
export function Panel({ title, actions, className, children, ...rest }: PanelProps) {
  return (
    <section className={cx("min-h-0 rounded border border-line bg-bg px-3 py-2.5", className)} {...rest}>
      {(title || actions) && (
        <header className="mb-2 flex min-h-5 items-center justify-between gap-2">
          {title && <h2 className={cx(labelClass, "m-0")}>{title}</h2>}
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
