import type { BoardColumn } from "../../types/host";

export const COLUMN_LABELS: Record<BoardColumn, string> = {
  enumerate: "Enumerate",
  foothold: "Foothold",
  privesc: "Privesc",
  loot: "Loot/Pivot",
  done: "Done",
};
