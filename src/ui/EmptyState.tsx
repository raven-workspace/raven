import type { ReactNode } from "react";
import { cx } from "../lib/cx";

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
    <div
      className={cx(
        "grid justify-items-start gap-2 rounded border border-dashed border-line-2 px-6 py-6",
        className,
      )}
    >
      <p className="m-0 text-body font-semibold text-fg">{title}</p>
      {body && <p className="m-0 max-w-[52ch] text-meta text-muted-2">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
