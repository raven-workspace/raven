import type { Ref, TextareaHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { controlBase } from "./controlStyles";

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
      className={cx(controlBase, "block w-full px-3 py-2 resize-y", mono && "font-mono text-code", className)}
      {...rest}
    />
  );
}
