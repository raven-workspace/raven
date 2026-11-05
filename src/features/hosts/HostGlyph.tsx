import type { BoardColumn } from "../../types/host";
import { COLUMN_LABELS } from "./columns";

const GLYPH: Record<BoardColumn, string> = {
  "information-gathering": "○",
  "vulnerability-detection": "◔",
  "initial-foothold": "◑",
  "privilege-escalation": "◕",
  "post-exploitation": "◉",
  reporting: "●",
};

/** Progress glyph for a host's board column. Colour only for "reporting" (a held fact). */
export function HostGlyph({ column }: { column: BoardColumn }) {
  return (
    <span
      role="img"
      aria-label={COLUMN_LABELS[column]}
      className={column === "reporting" ? "text-accent" : "text-muted-2"}
    >
      {GLYPH[column]}
    </span>
  );
}
