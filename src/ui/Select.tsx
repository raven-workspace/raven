import * as RS from "@radix-ui/react-select";
import type { Ref } from "react";
import { cx } from "../lib/cx";
import { controlBase } from "./controlStyles";

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
        className={cx(
          controlBase,
          "h-8 px-2.5 inline-flex items-center justify-between gap-2 text-left cursor-default",
          "data-placeholder:text-faint",
          className,
        )}
        {...triggerProps}
      >
        <RS.Value placeholder={placeholder} />
        <RS.Icon className="text-muted text-[10px]" aria-hidden>
          ▾
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-(--radix-select-trigger-width) max-h-(--radix-select-content-available-height) overflow-hidden rounded-sm border border-line-2 bg-surface"
        >
          <RS.Viewport className="p-1">
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className={cx(
                  "relative flex h-7 items-center rounded-[4px] pl-3 pr-2 text-[13px] text-fg-2 select-none cursor-default",
                  // Radix moves real focus onto the highlighted item, so that item carries the
                  // Ink focus ring: 1px accent outline drawn inside the item's edge.
                  "data-highlighted:bg-surface-hi data-highlighted:text-fg",
                  "data-highlighted:outline-solid data-highlighted:outline-1 data-highlighted:outline-accent -outline-offset-1",
                  // Selected item gets the Ink selection marker: a 2px accent bar on the left.
                  "data-[state=checked]:text-fg data-[state=checked]:shadow-[inset_2px_0_0_var(--accent)]",
                  "data-disabled:text-faint",
                )}
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
