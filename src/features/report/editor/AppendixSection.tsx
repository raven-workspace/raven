import type { EvidenceAttrs, ExploitAttrs, GeneratedAttrs, ReportNode } from "../../../engines/report";
import { StandaloneGuide } from "./GuideNote";
import { FullEvidence } from "./nodes/EvidenceView";
import { FullExploit } from "./nodes/ExploitView";
import { GeneratedContent } from "./nodes/GeneratedView";
import { ReportDataContext, type ReportDataValue } from "./ReportDataContext";
import "../page.css";

export interface AppendixPageEntry {
  /** "A.1" */
  ref: string;
  title: string;
  /** The moved node's index path in its section's page. */
  path: string;
  node: ReportNode;
}

/** A moved block in full: every line of output, the whole list or the whole file. */
function MovedBody({ node, ctx }: { node: ReportNode; ctx: ReportDataValue }) {
  const attrs = node.attrs ?? {};
  if (node.type === "evidence") return <FullEvidence attrs={attrs as unknown as EvidenceAttrs} />;
  if (node.type === "exploit") return <FullExploit attrs={attrs as unknown as ExploitAttrs} />;
  return <GeneratedContent attrs={attrs as unknown as GeneratedAttrs} ctx={ctx} />;
}

/**
 * A target's appendix (lettered from A in report order, spec §5.6): read-only, the content moved out of the target's page in
 * page order, each numbered and linking back to the place that references it.
 */
export function AppendixSection({
  title,
  source,
  entries,
  ctx,
  onBack,
}: {
  /** "Appendix A: lnx02" */
  title: string;
  /** The referencing section's name ("lnx02"). */
  source: string;
  entries: AppendixPageEntry[];
  ctx: ReportDataValue;
  onBack(path: string): void;
}) {
  return (
    <ReportDataContext.Provider value={ctx}>
      <div className="report-page">
        <div className="report-appendix">
          <StandaloneGuide id="appendix" />
          <h1>{title}</h1>
          {entries.map((e) => (
            <section key={e.path} className="report-appendix-entry" aria-label={`${e.ref} ${e.title}`}>
              <h3>{`${e.ref} ${e.title}`}</h3>
              <button type="button" className="report-backlink" onClick={() => onBack(e.path)}>
                {`Referenced from ${source}`}
              </button>
              <MovedBody node={e.node} ctx={ctx} />
            </section>
          ))}
        </div>
      </div>
    </ReportDataContext.Provider>
  );
}
