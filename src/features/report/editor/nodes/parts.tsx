import { ArrowSquareOut } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { AppendixPlacement } from "../../../../engines/report";
import { ActionCell, IconButton } from "../../../../ui";

/** The amber block that stands where a referenced row used to be. */
export function Gone({ text }: { text: string }) {
  return <div className="report-gone">{text}</div>;
}

/** Every report block sits in one frame, outlined while selected. */
export function Block({ selected, kind, children }: { selected: boolean; kind: string; children: ReactNode }) {
  return (
    <div className="report-block" data-block={kind} data-selected={selected || undefined}>
      {children}
    </div>
  );
}

/** The selected block's controls: an Ink toolbar floating above the block's top-right corner, never on the paper. */
export function BlockTools({ children }: { children: ReactNode }) {
  return (
    <div
      contentEditable={false}
      className="absolute right-0 bottom-full z-10 mb-2 grid rounded-md border border-line-strong bg-surface p-1 shadow-lg"
    >
      <ActionCell>{children}</ActionCell>
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
