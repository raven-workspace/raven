import type { InputHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";
import { controlBase } from "./controlStyles";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Monospace text, for IPs, CIDRs, commands, hashes. */
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ mono, className, type = "text", ...rest }: InputProps) {
  return (
    <input
      type={type}
      spellCheck={mono ? false : undefined}
      autoCorrect={mono ? "off" : undefined}
      autoCapitalize={mono ? "off" : undefined}
      className={cx(controlBase, "h-8 w-full px-3", mono && "font-mono text-code", className)}
      {...rest}
    />
  );
}
