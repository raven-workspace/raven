import type { ReactNode } from "react";
import { Collapse } from "./Collapse";
import { DisclosureCaret } from "./DisclosureCaret";

export interface DisclosureProps {
  label: string;
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/** Collapsible secondary content: a full-width row, 28px tall, closed by default at the call site. */
export function Disclosure({ label, count, open, onOpenChange, children }: DisclosureProps) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="grid min-h-7 w-full grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-sm border-0 bg-transparent px-1 text-left text-body text-muted-2 select-none cursor-default hover:bg-surface-hi hover:text-fg"
      >
        <DisclosureCaret open={open} />
        <span className="truncate">{count === undefined ? label : `${label} (${count})`}</span>
      </button>
      <Collapse open={open}>{children}</Collapse>
    </div>
  );
}
