import { EngagementChecklist } from "../checklist/EngagementChecklist";
import { Board } from "../board/Board";
import { LogSection } from "../log/LogSection";
import { CredentialsSection } from "../credentials/CredentialsSection";
import { FindingsSection } from "../findings/FindingsSection";
import { NetworkSection } from "../network/NetworkSection";
import { ReportSectionView } from "../report/ReportSection";

export const SECTIONS = [
  { id: "board", label: "Board" },
  { id: "log", label: "Log" },
  { id: "credentials", label: "Credentials" },
  { id: "findings", label: "Findings" },
  { id: "network", label: "Network" },
  { id: "checklist", label: "Engagement checklist" },
  { id: "report", label: "Report" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** Route for a section: the board is the engagement's index route. */
export function sectionPath(engagementId: string, section: SectionId): string {
  return section === "board" ? `/e/${engagementId}` : `/e/${engagementId}/s/${section}`;
}

export function SectionView({ section }: { section: SectionId }) {
  if (section === "board") return <Board />;
  if (section === "log") return <LogSection />;
  if (section === "credentials") return <CredentialsSection />;
  if (section === "findings") return <FindingsSection />;
  if (section === "network") return <NetworkSection />;
  if (section === "checklist") return <EngagementChecklist />;
  return <ReportSectionView />;
}
