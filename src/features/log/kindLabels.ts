import type { LogKind } from "../../types/log";

/** What each log kind is called on screen. `note` is stored as "note" but shown as "Other". */
export const KIND_LABELS: Record<LogKind, string> = {
  command: "Command",
  screenshot: "Screenshot",
  http: "HTTP",
  note: "Other",
  flag: "Flag",
};
