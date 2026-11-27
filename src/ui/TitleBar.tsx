import * as Popover from "@radix-ui/react-popover";
import { QuestionIcon, type Icon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { isTypingTarget } from "../lib/keys";
import { ariaKeys, keyLabel, type Keys } from "../lib/shortcuts";
import { HintUnit, type Hint } from "./HintLine";
import { labelClass } from "./Label";
import { usePageShortcutsStore } from "./pageShortcuts";
import { cx } from "../lib/cx";
import { hasNativeTitleBar } from "../lib/platform";
import { Kbd } from "./Kbd";
import { Tooltip } from "./Tooltip";
import "./TitleBar.scss";

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
 * Where a non-modal drawer docks: under the title bar, never over it, so the bar's controls stay whole and the window
 * keeps its drag region. Modal panels with an overlay (Capture) cover the whole window instead.
 */
export const BELOW_TITLE_BAR = "below-title-bar";

/**
 * The 38px window chrome. The bar is the drag region (`data-tauri-drag-region`);
 * The bar's content is pinned to the window edges on every screen (owner, 2026-11-09): the controls at pr-6, the
 * wordmark after 94px on the left, which is the macOS traffic lights' 78px (titleBarStyle Overlay) plus 16px of air.
 * A window-chrome constant, not a spacing step, allowed by name in the conventions test (SPACING_ALLOWED).
 * On Linux the desktop's own title bar sits above (or none, under a tiling compositor), with nothing under the bar's
 * left edge, so the bar drops the inset (`title-bar--below-native`, docs/specs/terminal.md §3).
 */
export function TitleBar({ left, title, right, className }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className={cx("title-bar", hasNativeTitleBar() && "title-bar--below-native", className)}
    >
      <div className="title-bar__left">{left}</div>
      {/* pointer-events-none so a drag on the text still lands on the drag region */}
      <span className="title-bar__title">{title}</span>
      <div className="title-bar__right">{right}</div>
    </div>
  );
}

/*
 * Title-bar controls are chrome, not page buttons: no border, the background only on hover. The control for the page on
 * screen (aria-current), or a drawer or popover that's open (aria-expanded), sits on the surface tint in accent, so where
 * you are reads without a row of boxes (TitleBar.scss).
 */

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
  hint: Keys;
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
      className="title-bar-control title-bar-control--text"
    >
      {Glyph && <Glyph size={16} weight="regular" aria-hidden />}
      {children}
      <Kbd variant="inline" aria-hidden="true">{keyLabel(hint)}</Kbd>
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
  shortcut?: Keys;
  /** This control's destination is the page on screen. */
  current?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip side="bottom" content={<span>{label}{shortcut && <span className="tooltip__key">{keyLabel(shortcut)}</span>}</span>}>
      <button
        type="button"
        aria-label={label}
        aria-current={current ? "page" : undefined}
        aria-keyshortcuts={shortcut && ariaKeys(shortcut)}
        onClick={onClick}
        className="title-bar-control title-bar-control--icon"
      >
        <Glyph size={16} weight="regular" aria-hidden />
      </button>
    </Tooltip>
  );
}

/** A run of title-bar controls that belong together; runs are set apart by space, never a divider. */
export function TitleBarGroup({ children }: { children: ReactNode }) {
  return <div className="title-bar-group">{children}</div>;
}

/**
 * The title bar's shortcut list: the page's own keys first (registered with `usePageShortcuts`), then the keys that
 * work everywhere. The `?` key opens it too, unless focus is inside a surface with its own list (a drawer, the Manual,
 * the palette) or a dialog.
 */
export function TitleBarShortcuts({ everywhere }: { everywhere: Hint[] }) {
  const [open, setOpen] = useState(false);
  const page = usePageShortcutsStore((s) => s.page);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const active = document.activeElement;
      if (active && (isTypingTarget(active) || active.closest("[data-hint-surface], [role=dialog]"))) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const group = (title: string, hints: Hint[]) => (
    <section aria-label={title} className="shortcuts-popover__group">
      <h2 className={labelClass}>{title}</h2>
      {hints.map((h) => <HintUnit key={keyLabel(h.keys)} hint={h} />)}
    </section>
  );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip side="bottom" content={<span>Shortcuts<span className="tooltip__key">?</span></span>}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label="Shortcuts"
            aria-keyshortcuts="?"
            className="title-bar-control title-bar-control--icon"
          >
            <QuestionIcon size={16} weight="regular" aria-hidden />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="popover-panel shortcuts-popover">
          {page && group(page.title, page.hints)}
          {group("Everywhere", everywhere)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
