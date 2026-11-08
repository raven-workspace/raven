import { Circle, CircleDashed, CircleHalf, CircleHalfTilt, CheckCircle, RadioButton, type Icon } from "@phosphor-icons/react";
import type { BoardColumn } from "../../types/host";
import { COLUMN_LABELS } from "./columns";

const GLYPH: Record<BoardColumn, Icon> = {
  "information-gathering": Circle,
  "vulnerability-detection": CircleDashed,
  "initial-foothold": CircleHalfTilt,
  "privilege-escalation": CircleHalf,
  "post-exploitation": RadioButton,
  reporting: CheckCircle,
};

/** Progress glyph for a host's board column, in a fixed 16px box. Colour only for "reporting" (a held fact). */
export function HostGlyph({ column }: { column: BoardColumn }) {
  const Glyph = GLYPH[column];
  return (
    <span
      role="img"
      aria-label={COLUMN_LABELS[column]}
      className={`grid size-4 place-items-center ${column === "reporting" ? "text-accent" : "text-muted-2"}`}
    >
      <Glyph size={16} weight="regular" aria-hidden />
    </span>
  );
}
