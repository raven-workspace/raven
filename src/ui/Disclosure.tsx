import type { ReactNode } from "react";
import { Collapse } from "./Collapse";
import { DisclosureCaret } from "./DisclosureCaret";
import "./Disclosure.scss";

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
        className="disclosure__toggle"
      >
        <DisclosureCaret open={open} />
        <span className="disclosure__label">{count === undefined ? label : `${label} (${count})`}</span>
      </button>
      <Collapse open={open}>{children}</Collapse>
    </div>
  );
}
