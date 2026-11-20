import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import "./states.scss";

export interface EmptyStateProps {
  title: ReactNode;
  /** One sentence: what goes here and how to add it. */
  body?: ReactNode;
  /** Usually one primary Button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cx("state state--empty", className)}>
      <p className="state__title">{title}</p>
      {body && <p className="state__body">{body}</p>}
      {action && <div className="state__action">{action}</div>}
    </div>
  );
}
