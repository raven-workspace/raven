import type { ButtonHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";
import "./Button.scss";

export type ButtonVariant = "primary" | "ghost" | "danger" | "quiet-danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "ghost", size = "md", type = "button", className, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      className={cx("button", `button--${variant}`, `button--${size}`, className)}
      {...rest}
    />
  );
}
