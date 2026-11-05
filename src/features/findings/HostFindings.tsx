import { useState } from "react";
import type { Finding } from "../../types/findings";
import type { Host } from "../../types/host";
import { sortFindingsBySeverity } from "../../engines/findings";
import { useEngagementServices } from "../checklist/queries";
import { useHosts } from "../hosts/queries";
import { FindingEditor } from "./FindingEditor";
import { SeverityChip } from "./FindingsSection";
import { useFindings } from "./queries";

/** The host view's Findings tab: findings that affect this host. Extend with more sections below the list. */
export function HostFindings({ engagementId, host }: { engagementId: string; host: Host }) {
  const findings = useFindings(engagementId);
  const hosts = useHosts(engagementId);
  const { servicesByHost, query: servicesQ } = useEngagementServices(engagementId);
  const [editing, setEditing] = useState<Finding>();

  const failed = findings.error ?? hosts.error ?? servicesQ.error;
  if (failed) return <p role="alert" className="text-xs text-warn">Couldn't load findings: {failed.message}</p>;
  if (!findings.data || !hosts.data || !servicesQ.data) return null;
  const mine = sortFindingsBySeverity(findings.data.filter((f) => f.hostIds.includes(host.id)));

  return (
    <div className="flex flex-col gap-4">
      {mine.length === 0 ? (
        <p className="text-[13px] text-muted">No findings on this host yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {mine.map((f) => (
            <li key={f.id} className="border-b border-line">
              <button
                type="button"
                aria-label={`Open ${f.title}`}
                onClick={() => setEditing(f)}
                className="flex w-full cursor-default items-center gap-3 px-1 py-2 text-left hover:bg-surface"
              >
                <span className="w-[72px] shrink-0"><SeverityChip severity={f.severity} /></span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{f.title}</span>
                <span className="text-xs text-fg-2">{f.status}</span>
                <span className="w-8 text-right font-mono text-xs tabular-nums text-fg-2">{f.cvssScore !== null ? f.cvssScore.toFixed(1) : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <FindingEditor eid={engagementId} hosts={hosts.data} servicesByHost={servicesByHost} edit={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}
