import type { Icon } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { keyLabel, type Keys } from "../lib/shortcuts";
import { Tooltip } from "./Tooltip";
import "./IconButton.scss";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: Icon;
  label: string;
  /** Shown in the tooltip: a shortcut (for this OS) or a key that is the same everywhere. */
  shortcut?: Keys;
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
          {shortcut && <span className="tooltip__key">{keyLabel(shortcut)}</span>}
        </>
      }
    >
      <button
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cx("icon-button", tone === "destructive" && "icon-button--destructive", className)}
        {...rest}
      >
        <Glyph size={16} weight="regular" aria-hidden />
      </button>
    </Tooltip>
  );
}
