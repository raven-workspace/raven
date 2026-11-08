import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import { Kbd } from "./Kbd";

export interface TitleBarProps {
  /** Interactive content at the far left, after the traffic lights (e.g. the home link). */
  left?: ReactNode;
  /** Centre-left text, e.g. "Lab A — srv11". */
  title?: ReactNode;
  /** Right-aligned controls. Interactive children opt out of dragging automatically. */
  right?: ReactNode;
  className?: string;
}

/**
 * The 38px window chrome. The bar is the drag region (`data-tauri-drag-region`);
 * The right inset (pr-6) equals the content column's px-6, so the controls end where page actions end.
 * 78px on the left are left clear for the macOS traffic lights (titleBarStyle Overlay).
 */
export function TitleBar({ left, title, right, className }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className={cx(
        "grid h-[38px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-line pr-6 pl-[78px] text-meta text-muted-2 select-none",
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
