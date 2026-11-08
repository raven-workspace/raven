import { CheckCircle } from "@phosphor-icons/react";
import type { BoardColumn } from "../../types/host";
import { COLUMN_LABELS } from "./columns";

/** Pie fill in quarters: 0 = empty ring, 4 = full disc. */
const FILL: Partial<Record<BoardColumn, 0 | 1 | 2 | 3 | 4>> = {
  "information-gathering": 0,
  "vulnerability-detection": 1,
  "initial-foothold": 2,
  "privilege-escalation": 3,
  "post-exploitation": 4,
};

// Wedge paths on a 16px box centred at (8,8), radius 5.
export const WEDGE = [
  "",
  "M8 8V3A5 5 0 0 1 13 8Z",
  "M8 8V3A5 5 0 0 1 8 13Z",
  "M8 8V3A5 5 0 1 1 3 8Z",
  "M8 3A5 5 0 1 1 8 13A5 5 0 1 1 8 3Z",
];

/** Progress glyph for a host's board column: a pie that fills a quarter per stage, in a fixed 16px box. Colour only for "reporting" (a held fact). */
export function HostGlyph({ column }: { column: BoardColumn }) {
  const done = column === "reporting";
  const fill = FILL[column] ?? 0;
  return (
    <span
      role="img"
      aria-label={COLUMN_LABELS[column]}
      className={`grid size-4 place-items-center ${done ? "text-accent" : "text-muted-2"}`}
    >
      {done ? (
        <CheckCircle size={16} weight="regular" aria-hidden />
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="currentColor">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {fill > 0 && <path d={WEDGE[fill]} />}
        </svg>
      )}
    </span>
  );
}
