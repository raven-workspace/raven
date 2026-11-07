import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import { Kbd } from "./Kbd";

export interface TitleBarProps {
  /** Interactive content at the far left, after the traffic lights (e.g. the home link). */
  left?: ReactNode;
  /** Centre-left text, e.g. "Mock exam A — Vega". */
  title?: ReactNode;
  /** Right-aligned controls. Interactive children opt out of dragging automatically. */
  right?: ReactNode;
  className?: string;
}

/**
 * The 38px window chrome. The bar is the drag region (`data-tauri-drag-region`);
 * 78px on the left are left clear for the macOS traffic lights (titleBarStyle Overlay).
 */
export function TitleBar({ left, title, right, className }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className={cx(
        "flex h-[38px] shrink-0 items-center gap-2 border-b border-line pr-3.5 pl-[78px] text-xs text-muted-2 select-none",
        className,
      )}
    >
      {left}
      {/* pointer-events-none so a drag on the text still lands on the drag region */}
      <span className="pointer-events-none truncate">{title}</span>
      <div className="ml-auto flex items-center gap-1.5">{right}</div>
    </div>
  );
}

/** A title-bar action: the accessible name is the visible word; the key hint is decoration. */
export function TitleBarButton({ children, hint, onClick }: { children: ReactNode; hint: string; onClick?: () => void }) {
  return (
    <Button size="sm" onClick={onClick}>
      {children} <Kbd aria-hidden="true">{hint}</Kbd>
    </Button>
  );
}
