import type { Icon } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: Icon;
  label: string;
  shortcut?: string;
  tone?: "default" | "destructive";
  active?: boolean;
}

export function IconButton({
  icon: Glyph,
  label,
  shortcut,
  tone = "default",
  active,
  type = "button",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip
      content={
        <>
          <span>{label}</span>
          {shortcut && <span className="ml-2 font-mono text-muted">{shortcut}</span>}
        </>
      }
    >
      <button
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cx(
          "inline-grid size-7 shrink-0 place-items-center rounded-sm border-0 bg-transparent select-none cursor-default",
          "transition-colors duration-100 hover:bg-surface-hi disabled:text-faint disabled:cursor-not-allowed",
          tone === "destructive" ? "text-muted hover:text-warn focus-visible:text-warn" : "text-fg-2 hover:text-fg",
          active && "bg-surface-hi text-fg",
          className,
        )}
        {...rest}
      >
        <Glyph size={16} weight="regular" aria-hidden />
      </button>
    </Tooltip>
  );
}
