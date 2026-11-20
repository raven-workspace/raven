import type { InputHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";
import "./controls.scss";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "width"> {
  /** Monospace text, for IPs, CIDRs, commands, hashes. */
  mono?: boolean;
  /** A class that sets the width, in place of the default full width. */
  width?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ mono, width, className, type = "text", ...rest }: InputProps) {
  return (
    <input
      type={type}
      spellCheck={mono ? false : undefined}
      autoCorrect={mono ? "off" : undefined}
      autoCapitalize={mono ? "off" : undefined}
      className={cx("control input", mono && "control--mono", width, className)}
      {...rest}
    />
  );
}
