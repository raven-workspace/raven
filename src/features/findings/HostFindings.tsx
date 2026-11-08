import { Plus } from "@phosphor-icons/react";
import type { Finding } from "../../types/findings";
import type { Host } from "../../types/host";
import { sortFindingsBySeverity } from "../../engines/findings";
import { Button, queryState } from "../../ui";
import { AttemptsList } from "./AttemptsList";
import { SeverityChip } from "./FindingsSection";
import { useFindings } from "./queries";

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
    <div className="grid gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pt-2">
        {mine.length === 0 ? <p className="m-0 text-meta text-muted">No findings on this host yet.</p> : <span />}
        <Button size="sm" title="Add finding (F)" onClick={() => onOpenFinding("new")}>
          <Plus size={16} weight="regular" aria-hidden /> Add finding
        </Button>
      </div>
      {mine.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-[72px_minmax(0,1fr)_max-content_max-content] gap-x-3 p-0">
          {mine.map((f) => (
            <li key={f.id} className="col-span-full grid grid-cols-subgrid border-b border-line">
              <button
                type="button"
                aria-label={`Open ${f.title}`}
                onClick={() => onOpenFinding(f)}
                className="-mx-1 col-span-full grid cursor-default grid-cols-subgrid items-start px-1 py-2 text-left hover:bg-surface"
              >
                <span className="grid h-5 content-center justify-self-start"><SeverityChip severity={f.severity} /></span>
                <span className="line-clamp-2 break-words text-body text-fg" title={f.title}>{f.title}</span>
                <span className="text-meta text-fg-2">{f.status}</span>
                <span className="text-right font-mono text-code tabular-nums text-fg-2">{f.cvssScore !== null ? f.cvssScore.toFixed(1) : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AttemptsList eid={engagementId} hostId={host.id} onOpenEntry={onOpenEntry} />
    </div>
  );
}
