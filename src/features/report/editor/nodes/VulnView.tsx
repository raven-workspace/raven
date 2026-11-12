import type { ReactNodeViewProps } from "prosekit/react";
import { fixSteps, type VulnAttrs } from "../../../../engines/report";
import { useReportData } from "../ReportDataContext";
import { Block, capitalize, Gone } from "./parts";

/**
 * A finding as OffSec's sample prints it at the top of the sub-section it enabled: Vulnerability Explanation (the
 * description), Vulnerability Fix (the remediation, one step per item), Severity (with the CVSS vector). The heading
 * above names it; Steps to reproduce the attack follows as the owner's slot. `lessons` is private and never read here.
 */
export function VulnView({ node, selected }: ReactNodeViewProps) {
  const { data } = useReportData();
  const finding = data.findings.find((f) => f.id === (node.attrs as VulnAttrs).findingId);
  if (!finding)
    return (
      <Block selected={selected} kind="vuln">
        <Gone text="This finding was deleted" />
      </Block>
    );
  const severity = finding.severity ? capitalize(finding.severity) : "Not rated";
  const fixes = fixSteps(finding.remediation);
  return (
    <Block selected={selected} kind="vuln">
      <div className="report-vuln">
        <p className="report-prose">
          <strong>Vulnerability Explanation:</strong> {finding.description || <span className="report-missing">Not written yet.</span>}
        </p>
        {fixes.length > 1 ? (
          <>
            <p>
              <strong>Vulnerability Fix:</strong>
            </p>
            <ul>
              {fixes.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="report-prose">
            <strong>Vulnerability Fix:</strong> {fixes[0] ?? <span className="report-missing">Not written yet.</span>}
          </p>
        )}
        <p>
          <strong>Severity:</strong> {severity}
          {finding.cvssVector && <span className="report-cvss"> ({finding.cvssVector})</span>}
        </p>
      </div>
    </Block>
  );
}
