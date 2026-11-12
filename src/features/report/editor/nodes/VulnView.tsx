import type { ReactNodeViewProps } from "prosekit/react";
import { fixSteps, type ReportData, type VulnAttrs } from "../../../../engines/report";
import type { Finding } from "../../../../types/findings";
import { useReportData } from "../ReportDataContext";
import { Block, capitalize, Gone } from "./parts";

/** Host (IP) and port/protocol of each host and service the finding is linked to. */
function affected(finding: Finding, data: ReportData): string[] {
  const hosts = data.hosts
    .filter((h) => finding.hostIds.includes(h.id))
    .map((h) => (h.ip ? `${h.name} (${h.ip})` : h.name));
  const services = data.services
    .filter((s) => finding.serviceIds.includes(s.id))
    .map((s) => {
      const host = data.hosts.find((h) => h.id === s.hostId);
      return `${host?.ip ?? host?.name ?? ""}${host ? " " : ""}port ${s.port}/${s.protocol}`;
    });
  return [...hosts, ...services];
}

/** A finding as the report's vulnerability block. `lessons` is private and never read here. */
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
  const where = affected(finding, data);
  return (
    <Block selected={selected} kind="vuln">
      <div className="report-vuln">
        <h4 className="report-h4">{finding.title}</h4>
        <p>{finding.cvssVector ? `Severity: ${severity} (${finding.cvssVector})` : `Severity: ${severity}`}</p>
        {where.length > 0 && <p>Affected: {where.join(", ")}</p>}
        {finding.description && (
          <>
            <p className="report-label">Description</p>
            <p className="report-prose">{finding.description}</p>
          </>
        )}
        {finding.impact && (
          <>
            <p className="report-label">Impact</p>
            <p className="report-prose">{finding.impact}</p>
          </>
        )}
        {fixes.length > 0 && (
          <>
            <p className="report-label">Fix</p>
            <ul>
              {fixes.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </>
        )}
        {finding.refs.length > 0 && (
          <>
            <p className="report-label">References</p>
            <ul>
              {finding.refs.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Block>
  );
}
