import { CaretDown } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "../lib/cx";
import "./PickerTrigger.scss";

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
      data-picker-trigger=""
      className={cx("picker-trigger", className)}
      {...rest}
    >
      {icon}
      {prefix && <span className="picker-trigger__prefix">{prefix}</span>}
      {value ? (
        <span className={cx("picker-trigger__value", warn && "picker-trigger__value--warn")}>{value}</span>
      ) : (
        <span className="picker-trigger__placeholder">{placeholder}</span>
      )}
      <CaretDown size={12} aria-hidden className="picker-trigger__caret" />
    </button>
  );
}
