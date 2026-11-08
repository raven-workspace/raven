import type { InputHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";
import { controlBase } from "./controlStyles";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "width"> {
  /** Monospace text, for IPs, CIDRs, commands, hashes. */
  mono?: boolean;
  /**
   * The width utility, in place of the default `w-full` (a `w-*` in className would compete with it, and Tailwind's
   * order, not the class order, decides which wins).
   */
  width?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ mono, width = "w-full", className, type = "text", ...rest }: InputProps) {
  return (
    <input
      type={type}
      spellCheck={mono ? false : undefined}
      autoCorrect={mono ? "off" : undefined}
      autoCapitalize={mono ? "off" : undefined}
      className={cx(controlBase, "h-8 px-3", width, mono && "font-mono text-code", className)}
      {...rest}
    />
  );
}
