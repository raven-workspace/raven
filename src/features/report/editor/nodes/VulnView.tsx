import type { ReactNodeViewProps } from "prosekit/react";
import { fixSteps, splitAffected, type VulnAttrs } from "../../../../engines/report";
import { useReportData } from "../ReportDataContext";
import { FindingProse, InlineText } from "./FindingProse";
import { Block, capitalize, Gone } from "./parts";

const notWritten = <span className="report-missing">Not written yet.</span>;

/**
 * A finding as OffSec's sample prints it under its heading: Vulnerability Explanation (the description), Vulnerability
 * Fix (the remediation, one step per item; as written when it holds a code block or a table), Severity (with the CVSS vector); an "Affected: …" line the description
 * opened with is a labelled line of its own, never part of the explanation. Finding text is Markdown. The heading
 * above names the finding; Steps to reproduce the attack follows as the owner's slot. `lessons` is private and never
 * read here.
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
  const { affected, explanation } = splitAffected(finding.description);
  const fixes = fixSteps(finding.remediation);
  // A fix with a code fence or a table is block Markdown: rendered as written, not split into steps.
  const blockFix = /^\s*(?:```|~~~)|^\s*\|?\s*:?-{3,}/m.test(finding.remediation);
  return (
    <Block selected={selected} kind="vuln">
      <div className="report-vuln">
        <FindingProse label="Vulnerability Explanation:" text={explanation} missing={notWritten} />
        {blockFix ? (
          <FindingProse label="Vulnerability Fix:" text={finding.remediation} missing={notWritten} />
        ) : fixes.length > 1 ? (
          <>
            <p>
              <strong>Vulnerability Fix:</strong>
            </p>
            <ul>
              {fixes.map((f, i) => (
                <li key={i}>
                  <InlineText text={f} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            <strong>Vulnerability Fix:</strong> {fixes[0] ? <InlineText text={fixes[0]} /> : notWritten}
          </p>
        )}
        <p>
          <strong>Severity:</strong> {severity}
          {finding.cvssVector && <span className="report-cvss"> ({finding.cvssVector})</span>}
        </p>
        {affected && (
          <p>
            <strong>Affected:</strong> <InlineText text={affected} />
          </p>
        )}
      </div>
    </Block>
  );
}
