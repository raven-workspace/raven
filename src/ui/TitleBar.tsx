import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import { Kbd } from "./Kbd";
import type { PageColumn } from "./pageColumns";
import { Tooltip } from "./Tooltip";

export interface TitleBarProps {
  /** Interactive content at the far left, after the traffic lights (e.g. the home link). */
  left?: ReactNode;
  /** Centre-left text, e.g. "Lab A — srv11". */
  title?: ReactNode;
  /** Right-aligned controls. Interactive children opt out of dragging automatically. */
  right?: ReactNode;
  /**
   * Screens whose page content is a centred, max-width column: the bar's inner track follows that column
   * (wordmark at its left edge, controls at its right edge). `inset` is the column's own side padding.
   */
  column?: PageColumn;
  className?: string;
}

/**
 * The 38px window chrome. The bar is the drag region (`data-tauri-drag-region`);
 * The right inset (pr-6) equals the content column's px-6, so the controls end where page actions end.
 * 78px on the left are left clear for the macOS traffic lights (titleBarStyle Overlay).
 */
export function TitleBar({ left, title, right, column, className }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      // % padding is of the bar's own width, so this is half the free space beside the column plus its inset.
      style={
        column
          ? {
              paddingLeft: `max(78px, calc((100% - ${column.max}px) / 2 + ${column.inset}px))`,
              paddingRight: `max(${column.inset}px, calc((100% - ${column.max}px) / 2 + ${column.inset}px))`,
            }
          : undefined
      }
      className={cx(
        "grid h-[38px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-line text-meta text-muted-2 select-none",
        !column && "pr-6 pl-[78px]",
        className,
      )}
    >
      <div className="grid grid-flow-col items-center">{left}</div>
      {/* pointer-events-none so a drag on the text still lands on the drag region */}
      <span className="pointer-events-none truncate">{title}</span>
      <div className="grid grid-flow-col items-center gap-1.5">{right}</div>
    </div>
  );
}

/** A title-bar action: the accessible name is the visible word; the key hint is decoration. */
export function TitleBarButton({
  children,
  hint,
  icon: Glyph,
  onClick,
}: {
  children: ReactNode;
  hint: string;
  icon?: Icon;
  onClick?: () => void;
}) {
  return (
    <Button size="sm" onClick={onClick}>
      {Glyph && <Glyph size={16} weight="regular" aria-hidden />}
      {children} <Kbd variant="inline" aria-hidden="true">{hint}</Kbd>
    </Button>
  );
}

/** The bordered icon-only twin of TitleBarButton (28px box), so the whole row is one style. */
export function TitleBarIconButton({
  icon: Glyph,
  label,
  current,
  onClick,
}: {
  icon: Icon;
  label: string;
  /** This control's destination is the page on screen. */
  current?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip content={<span>{label}</span>}>
      <button
        type="button"
        aria-label={label}
        aria-current={current ? "page" : undefined}
        onClick={onClick}
        className={cx(
          // Own classes, not Button's: cx does not merge, so size/variant classes would fight w-7/p-0 and the accent.
          "inline-grid size-7 place-items-center rounded-sm border bg-bg p-0 cursor-default select-none transition-colors duration-100",
          "hover:bg-surface-hi hover:border-line-strong",
          current ? "border-line-strong text-accent" : "border-line-2 text-fg-2 hover:text-fg",
        )}
      >
        <Glyph size={16} weight="regular" aria-hidden className="shrink-0" />
      </button>
    </Tooltip>
  );
}
