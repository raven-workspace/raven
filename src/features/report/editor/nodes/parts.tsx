import { ArrowSquareOut } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { AppendixPlacement } from "../../../../engines/report";
import { IconButton } from "../../../../ui";
import { usePageLayout } from "../ReportDataContext";

/** The amber block that stands where a referenced row used to be. */
export function Gone({ text }: { text: string }) {
  return <div className="report-gone">{text}</div>;
}

/** Every report block sits in one frame, outlined while selected. ProseMirror's default selection (often the first
 *  block) is no choice of the owner's, so nothing is outlined until they click or focus into the page. */
export function Block({ selected, kind, children }: { selected: boolean; kind: string; children: ReactNode }) {
  const { touched } = usePageLayout();
  return (
    <div className="report-block" data-block={kind} data-selected={(selected && touched) || undefined}>
      {children}
    </div>
  );
}

/**
 * The selected block's controls: a column of Ink icon buttons in the page's right gutter, level with the block's top,
 * never over the paper's content (the gutter is 40px; the column is 30px wide, 8px off the text). On a block taller
 * than the pane the column stays in view under the formatting bar while the block is on screen.
 */
export function BlockTools({ children }: { children: ReactNode }) {
  return (
    <div contentEditable={false} className="pointer-events-none absolute top-0 bottom-0 left-full z-10 ml-2 grid content-start">
      {/* The pane's 24px top padding is inside the sticky inset: top-6 sits 48px below the pane's edge, under the 41px bar. */}
      <div className="pointer-events-auto sticky top-6 grid gap-1 rounded-md border border-line-strong bg-surface shadow-lg">{children}</div>
    </div>
  );
}

/**
 * Move to appendix, one press per step: inline, moved, then (for trimmable output) split, then back inline. The
 * tooltip names what the next press does.
 */
export function MoveButton({ place, canSplit, onMove }: { place: AppendixPlacement; canSplit: boolean; onMove(next: AppendixPlacement): void }) {
  const next: AppendixPlacement = place === "inline" ? "moved" : place === "moved" && canSplit ? "split" : "inline";
  const label = next === "moved" ? "Move to appendix" : next === "split" ? "Trimmed here, full output in the appendix" : "Back inline";
  return <IconButton icon={ArrowSquareOut} label={label} active={place !== "inline"} onClick={() => onMove(next)} />;
}

/** The one-line pointer a moved block leaves behind: "Full output: Appendix E.2, title". */
export function AppendixRef({ label, refText }: { label: string; refText: string | null }) {
  return <p className="report-ref">{refText ? `${label}: Appendix ${refText}` : `${label}: moved to the appendices`}</p>;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
