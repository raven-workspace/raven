import * as RS from "@radix-ui/react-select";
import { CaretDown } from "@phosphor-icons/react";
import type { Ref } from "react";
import { cx } from "../lib/cx";
import "./controls.scss";
import "./Select.scss";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  /** Tooltip on the trigger, e.g. the full value when it is ellipsized. */
  title?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen,
  onOpenChange,
  placeholder,
  disabled,
  name,
  className,
  ref,
  ...triggerProps
}: SelectProps) {
  return (
    <RS.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disabled={disabled}
      name={name}
    >
      <RS.Trigger
        ref={ref}
        className={cx("control select-trigger", className)}
        {...triggerProps}
      >
        {/* A long value ellipsizes instead of wrapping the trigger. */}
        <span className="select-trigger__value">
          <RS.Value placeholder={placeholder} />
        </span>
        <RS.Icon className="select-trigger__icon" aria-hidden>
          <CaretDown size={12} />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={4}
          className="select-menu"
        >
          <RS.Viewport className="select-menu__viewport">
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="select-item"
              >
                <RS.ItemText>{o.label}</RS.ItemText>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
