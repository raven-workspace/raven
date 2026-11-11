import { CaretRightIcon } from "@phosphor-icons/react";

/** A disclosure's caret: one right-pointing caret that turns down when open (150ms), rather than two icons swapped. */
export function DisclosureCaret({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <CaretRightIcon
      size={16}
      weight="regular"
      aria-hidden
      className={`shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${open ? "rotate-90" : ""} ${className}`}
    />
  );
}

/**
 * The same turn for an IconButton given `icon={CaretRightIcon}`: its glyph rotates from the button's `aria-expanded`.
 */
export const CARET_TURN =
  "[&>svg]:transition-transform [&>svg]:duration-150 [&>svg]:ease-out motion-reduce:[&>svg]:transition-none aria-expanded:[&>svg]:rotate-90";
