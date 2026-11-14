import type { Engagement } from "../../types/engagement";
import type { FlagKind, ReportMeta, ReportTarget } from "./types";

const DAY_MS = 86_400_000;

/** OffSec student IDs look like OS-12345. */
export function isValidOsid(osid: string): boolean {
  return /^OS-\d+$/.test(osid);
}

/** The proof flags a host is expected to have: the override, else the target kind's default. */
export function expectedFlags(target: ReportTarget, hostId: string, meta: ReportMeta): FlagKind[] {
  return meta.expectedFlags?.[hostId] ?? (target.kind === "standalone" ? ["local", "proof"] : ["proof"]);
}

export function reportFileName(osid: string): string {
  return `OSCP-${isValidOsid(osid) ? osid : "OS-?????"}-Exam-Report.pdf`;
}

/** Exam end plus 24 h for the report; null when there is no exam end to count from. */
export function reportDueAt(engagement: Engagement, meta: ReportMeta): number | null {
  if (engagement.kind === "client") return null;
  if (meta.examEndAt != null) return meta.examEndAt + DAY_MS;
  if (engagement.kind !== "exam-sim" || engagement.timeboxStart == null || engagement.timeboxMinutes == null) return null;
  return engagement.timeboxStart + engagement.timeboxMinutes * 60_000 + DAY_MS;
}
