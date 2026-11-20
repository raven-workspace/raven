import type { Ref, TextareaHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import "./controls.scss";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Monospace text, for pasted output and commands. */
  mono?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ mono, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      spellCheck={mono ? false : undefined}
      className={cx("control textarea", mono && "control--mono", className)}
      {...rest}
    />
  );
}
