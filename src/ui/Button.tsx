import type { ButtonHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-sm border bg-bg font-medium whitespace-nowrap " +
  "select-none transition-colors duration-100 cursor-default " +
  "disabled:border-line disabled:text-faint disabled:bg-bg disabled:cursor-not-allowed";

const variants: Record<ButtonVariant, string> = {
  // Accent text and hairline on black. Never a filled accent block.
  primary: "border-accent text-accent enabled:hover:bg-surface-hi",
  ghost: "border-line-2 text-fg-2 enabled:hover:bg-surface-hi enabled:hover:text-fg enabled:hover:border-line-strong",
  // No red in Ink: destructive actions use the warning amber.
  danger: "border-warn text-warn enabled:hover:bg-surface-hi",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-body",
  md: "h-8 px-3 text-body",
};

export function Button({ variant = "ghost", size = "md", type = "button", className, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      className={cx(base, variants[variant], sizes[size], className)}
      {...rest}
    />
  );
}
