import { ArrowSquareOut, X, type Icon } from "@phosphor-icons/react";
import type { KeyboardEvent, ReactNode } from "react";
import type { AppendixPlacement } from "../../../../engines/report";
import { IconButton, Tooltip } from "../../../../ui";
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

/** "1 line", "12 lines". */
export const linesWord = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

/** Where a moved or split block's chip points: "→ Appendix A.1, title". */
export const appendixPointer = (refText: string | null) => (refText ? `→ Appendix ${refText}` : "→ moved to the appendices");

/**
 * Evidence in a step, collapsed (§10.2): one line with what it is (`label`) and a quieter `meta`. A click (or ↵ while
 * it is selected) opens it in place. A moved block's chip is dashed, like the reference it stands for.
 */
export function Chip({ label, meta, moved, onOpen }: { label: ReactNode; meta?: ReactNode; moved?: boolean; onOpen(): void }) {
  return (
    <button type="button" className="report-chip" data-moved={moved || undefined} aria-expanded={false} onClick={onOpen}>
      {label}
      {meta !== undefined && <span className="report-chip-meta">{meta}</span>}
    </button>
  );
}

/** A chip whose entry was deleted or made private: the amber placeholder's words, as a chip that never opens. */
export function GoneChip({ text }: { text: string }) {
  return (
    <span className="report-chip" data-gone="">
      {text}
    </span>
  );
}

/** A text action in an open chip's bar: the page's own control, on the paper. */
export function BarButton({ children, pressed, disabled, onClick }: { children: ReactNode; pressed?: boolean; disabled?: boolean; onClick(): void }) {
  return (
    <button type="button" className="report-bar-btn" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** A compact icon action in an open chip's bar, named by its tooltip. */
export function BarIcon({ icon: Glyph, label, shortcut, pressed, onClick }: { icon: Icon; label: string; shortcut?: string; pressed?: boolean; onClick(): void }) {
  return (
    <Tooltip
      content={
        <>
          <span>{label}</span>
          {shortcut && <span className="ml-2 font-mono text-muted">{shortcut}</span>}
        </>
      }
    >
      <button type="button" className="report-bar-icon" aria-label={label} aria-pressed={pressed} onClick={onClick}>
        <Glyph size={14} weight="bold" aria-hidden />
      </button>
    </Tooltip>
  );
}

/**
 * An open chip: the bar (what the block is and how much shows, its actions, close), the block exactly as it prints,
 * then how many lines the page cuts. Esc anywhere in it closes it, unless a control inside took the key first.
 */
export function OpenChip({
  label,
  actions,
  onClose,
  cut,
  children,
}: {
  /** What the block is, then how much shows: each its own part, set apart by space (never a joining "·"). */
  label: string[];
  actions: ReactNode;
  onClose(): void;
  /** Output lines the page leaves out; 0 shows no line. */
  cut: number;
  children: ReactNode;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  };
  return (
    <div className="report-open" onKeyDown={onKey}>
      <div className="report-open-bar" contentEditable={false}>
        <span className="report-open-label">
          {label.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </span>
        <span className="report-open-actions">
          {actions}
          <BarIcon icon={X} label="Close" shortcut="Esc" onClick={onClose} />
        </span>
      </div>
      <div className="report-open-body">{children}</div>
      {cut > 0 && (
        <p className="report-cut" contentEditable={false}>
          {`${linesWord(cut)} cut. The PDF prints exactly what's shown here.`}
        </p>
      )}
    </div>
  );
}

/** Move to appendix as the open chip's bar and the block menu name it: to the appendix, or back inline. */
export const moveLabel = (place: AppendixPlacement) => (place === "inline" ? "Move to appendix" : "Back inline");
