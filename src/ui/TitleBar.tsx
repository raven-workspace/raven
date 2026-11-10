import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Kbd } from "./Kbd";
import { Tooltip } from "./Tooltip";

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
 * The bar's content is pinned to the window edges on every screen (owner, 2026-11-09): the controls at pr-6, the
 * wordmark after 94px on the left, which is the macOS traffic lights' 78px (titleBarStyle Overlay) plus 16px of air.
 * A window-chrome constant, not a spacing step, allowed by name in the conventions test (SPACING_ALLOWED).
 */
/**
 * Where a non-modal drawer docks: under the title bar, never over it, so the bar's controls stay whole and the window
 * keeps its drag region. Modal panels with an overlay (Capture) cover the whole window instead.
 */
export const BELOW_TITLE_BAR = "top-[38px] bottom-0";

export function TitleBar({ left, title, right, className }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className={cx(
        "grid h-[38px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-line pl-[94px] pr-6 text-meta text-muted-2 select-none",
        className,
      )}
    >
      <div className="grid grid-flow-col items-center">{left}</div>
      {/* pointer-events-none so a drag on the text still lands on the drag region */}
      <span className="pointer-events-none truncate">{title}</span>
      <div className="grid grid-flow-col items-center gap-4">{right}</div>
    </div>
  );
}

/*
 * Title-bar controls are chrome, not page buttons: no border, the background only on hover. The control for the page on
 * screen, or a drawer that's open, sits on the surface tint in accent, so where you are reads without a row of boxes.
 */
const chrome = "rounded-sm cursor-default select-none transition-colors duration-100";
const chromeState = (on: boolean | undefined) => (on ? "bg-surface text-accent" : "text-fg-2 hover:bg-surface-hi hover:text-fg");

/** A title-bar action: the accessible name is the visible word; the key hint is decoration. */
export function TitleBarButton({
  children,
  hint,
  icon: Glyph,
  current,
  open,
  onClick,
}: {
  children: ReactNode;
  hint: string;
  icon?: Icon;
  /** This control's destination is the page on screen: its icon and word turn accent. */
  current?: boolean;
  /** For a drawer toggle: the drawer is open. Accent like `current`, and announced as expanded. */
  open?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      aria-expanded={open}
      className={cx("inline-grid h-7 grid-flow-col items-center gap-2 px-2 text-body font-medium whitespace-nowrap", chrome, chromeState(current || open))}
    >
      {Glyph && <Glyph size={16} weight="regular" aria-hidden />}
      {children}
      <Kbd variant="inline" aria-hidden="true">{hint}</Kbd>
    </button>
  );
}

/** The icon-only twin of TitleBarButton (28px box); its key, if any, is in the tooltip. */
export function TitleBarIconButton({
  icon: Glyph,
  label,
  shortcut,
  current,
  onClick,
}: {
  icon: Icon;
  label: string;
  shortcut?: string;
  /** This control's destination is the page on screen. */
  current?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip side="bottom" content={<span>{label}{shortcut && <span className="ml-2 font-mono text-muted">{shortcut}</span>}</span>}>
      <button
        type="button"
        aria-label={label}
        aria-current={current ? "page" : undefined}
        aria-keyshortcuts={shortcut?.replace("⌘", "Meta+")}
        onClick={onClick}
        className={cx("inline-grid size-7 place-items-center p-0", chrome, chromeState(current))}
      >
        <Glyph size={16} weight="regular" aria-hidden className="shrink-0" />
      </button>
    </Tooltip>
  );
}

/** A run of title-bar controls that belong together; runs are set apart by space, never a divider. */
export function TitleBarGroup({ children }: { children: ReactNode }) {
  return <div className="grid grid-flow-col items-center gap-1">{children}</div>;
}
