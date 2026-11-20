import { CaretRightIcon } from "@phosphor-icons/react";
import { cx } from "../lib/cx";
import "./Disclosure.scss";

/** A disclosure's caret: one right-pointing caret that turns down when open (150ms), rather than two icons swapped. */
export function DisclosureCaret({ open, className }: { open: boolean; className?: string }) {
  return (
    <CaretRightIcon
      size={16}
      weight="regular"
      aria-hidden
      className={cx("disclosure-caret", open && "disclosure-caret--open", className)}
    />
  );
}

/**
 * The same turn for an IconButton given `icon={CaretRightIcon}`: its glyph rotates from the button's `aria-expanded`.
 */
export const CARET_TURN = "caret-turn";
