import type { BoardColumn, HostOs } from "../../types/host";

export const COLUMN_LABELS: Record<BoardColumn, string> = {
  enumerate: "Enumerate",
  foothold: "Foothold",
  privesc: "Privesc",
  loot: "Loot/Pivot",
  done: "Done",
};

export const OS_LABELS: Record<HostOs, string> = {
  windows: "Windows",
  linux: "Linux",
  other: "Other",
};
