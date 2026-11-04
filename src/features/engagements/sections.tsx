import { EmptyState } from "../../ui";
import { EngagementChecklist } from "../checklist/EngagementChecklist";
import { Board } from "../board/Board";
import { LogSection } from "../log/LogSection";
import { CredentialsSection } from "../credentials/CredentialsSection";

export const SECTIONS = [
  { id: "board", label: "Board", empty: "" },
  { id: "log", label: "Log", empty: "Log arrives in a later build step" },
  { id: "credentials", label: "Credentials", empty: "Credentials arrive in a later build step" },
  { id: "findings", label: "Findings", empty: "Findings arrive in a later build step" },
  { id: "checklist", label: "Engagement checklist", empty: "The engagement checklist arrives in a later build step" },
  { id: "report", label: "Report", empty: "Report arrives in phase 3" },
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
  if (section === "checklist") return <EngagementChecklist />;
  const s = SECTIONS.find((x) => x.id === section)!;
  return <EmptyState title={s.empty} />;
}
