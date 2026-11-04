import type { BoardColumn } from "../../types/host";
import { COLUMN_LABELS } from "./columns";

const GLYPH: Record<BoardColumn, string> = {
  enumerate: "○",
  foothold: "◔",
  privesc: "◑",
  loot: "◕",
  done: "●",
};

/** Progress glyph for a host's board column. Colour only for "done" (a held fact). */
export function HostGlyph({ column }: { column: BoardColumn }) {
  return (
    <span
      role="img"
      aria-label={COLUMN_LABELS[column]}
      className={column === "done" ? "text-accent" : "text-muted-2"}
    >
      {GLYPH[column]}
    </span>
  );
}
