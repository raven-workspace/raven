import { CaretDown } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "../lib/cx";

export interface PickerTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  prefix: string;
  value?: string;
  placeholder?: string;
  icon?: ReactNode;
  /** The value reads amber: a clue says it may be wrong (the value itself stays). */
  warn?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** A context picker button: "Host  192.0.2.10 v". An unset value says "Pick one" in warn. */
export function PickerTrigger({ prefix, value, placeholder = "Pick one", icon, warn, type = "button", className, ...rest }: PickerTriggerProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-grid h-7 max-w-full grid-flow-col items-center gap-2 rounded-sm border border-line-2 bg-transparent px-2 text-left select-none cursor-default hover:bg-surface-hi",
        className,
      )}
      {...rest}
    >
      {icon}
      {prefix && <span className="text-meta text-muted-2">{prefix}</span>}
      {value ? (
        <span className={cx("min-w-0 truncate text-body", warn ? "text-warn" : "text-fg")}>{value}</span>
      ) : (
        <span className="text-body text-warn">{placeholder}</span>
      )}
      <CaretDown size={12} aria-hidden className="text-fg-2" />
    </button>
  );
}
