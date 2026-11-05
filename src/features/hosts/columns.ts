import type { BoardColumn, HostOs } from "../../types/host";

export const COLUMN_LABELS: Record<BoardColumn, string> = {
  "information-gathering": "Information gathering",
  "vulnerability-detection": "Vulnerability detection",
  "initial-foothold": "Initial foothold",
  "privilege-escalation": "Privilege escalation",
  "post-exploitation": "Post-exploitation",
  reporting: "Reporting",
};

export const OS_LABELS: Record<HostOs, string> = {
  windows: "Windows",
  linux: "Linux",
  other: "Other",
};
