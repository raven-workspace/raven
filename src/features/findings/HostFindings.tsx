import { Plus } from "@phosphor-icons/react";
import type { Finding } from "../../types/findings";
import type { Host } from "../../types/host";
import { sortFindingsBySeverity } from "../../engines/findings";
import { Button, queryState } from "../../ui";
import { AttemptsList } from "./AttemptsList";
import { SeverityChip } from "./FindingsSection";
import { useFindings } from "./queries";
import "./HostFindings.scss";

/** The host view's Findings tab: findings that affect this host. Adding or opening one splits the host page. */
export function HostFindings({ engagementId, host, onOpenEntry, onOpenFinding }: {
  engagementId: string;
  host: Host;
  onOpenEntry: (entryId: string) => void;
  /** Opens the finding split: an existing finding, or "new" for one on this host. */
  onOpenFinding: (f: Finding | "new") => void;
}) {
  const findings = useFindings(engagementId);

  const state = queryState([findings], "findings");
  if (state || !findings.data) return state;
  const mine = sortFindingsBySeverity(findings.data.filter((f) => f.hostIds.includes(host.id)));

  return (
    <div className="host-findings">
      <div className="host-findings__header">
        {mine.length === 0 ? <p className="host-findings__empty">No findings on this host yet.</p> : <span />}
        <Button size="sm" title="Add finding (F)" onClick={() => onOpenFinding("new")}>
          <Plus size={16} weight="regular" aria-hidden /> Add finding
        </Button>
      </div>
      {mine.length > 0 && (
        <ul className="host-findings__list">
          {mine.map((f) => (
            <li key={f.id} className="host-findings__item">
              <button
                type="button"
                aria-label={`Open ${f.title}`}
                onClick={() => onOpenFinding(f)}
                className="host-findings__open"
              >
                <span className="host-findings__severity"><SeverityChip severity={f.severity} /></span>
                <span className="host-findings__title" title={f.title}>{f.title}</span>
                <span className="host-findings__status">{f.status}</span>
                <span className="host-findings__score">{f.cvssScore !== null ? f.cvssScore.toFixed(1) : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AttemptsList eid={engagementId} hostId={host.id} onOpenEntry={onOpenEntry} />
    </div>
  );
}
