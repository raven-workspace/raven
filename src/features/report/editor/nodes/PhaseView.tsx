import type { ReactNodeViewProps } from "prosekit/react";
import type { Phase, PhaseAttrs } from "../../../../engines/report";
import { useReportData } from "../ReportDataContext";
import { Block } from "./parts";

const PHASE_HEADINGS: Record<Phase, string> = {
  foothold: "Initial access",
  privesc: "Privilege escalation",
  lateral: "Lateral movement",
  domain: "Domain compromise",
  proof: "Proof",
  tested: "Tested, not exploited",
};

/** A sub-section heading; in the AD set it names the machine too. */
export function PhaseView({ node, selected }: ReactNodeViewProps) {
  const { data } = useReportData();
  const attrs = node.attrs as PhaseAttrs;
  const host = data.hosts.find((h) => h.id === attrs.hostId);
  const label = PHASE_HEADINGS[attrs.phase] ?? attrs.phase;
  return (
    <Block selected={selected} kind="phase">
      <h3 className="report-h3">{host?.adSetEffective ? `${label}: ${host.name}` : label}</h3>
    </Block>
  );
}
