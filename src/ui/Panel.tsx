import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import { labelClass } from "./Label";
import "./Panel.scss";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Small uppercase heading, like the mockup's card h5. */
  title?: ReactNode;
  /** Right-aligned controls in the heading row. */
  actions?: ReactNode;
}

/** Flat hairline box on black. No fill, no shadow. */
export function Panel({ title, actions, className, children, ...rest }: PanelProps) {
  return (
    <section className={cx("panel", className)} {...rest}>
      {(title || actions) && (
        <header className="panel__header">
          {title && <h2 className={labelClass}>{title}</h2>}
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
