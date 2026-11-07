import { Plus } from "@phosphor-icons/react";
import type { Finding } from "../../types/findings";
import type { Host } from "../../types/host";
import { sortFindingsBySeverity } from "../../engines/findings";
import { Button } from "../../ui";
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

  if (findings.error) return <p role="alert" className="text-xs text-warn">Couldn't load findings: {findings.error.message}</p>;
  if (!findings.data) return null;
  const mine = sortFindingsBySeverity(findings.data.filter((f) => f.hostIds.includes(host.id)));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pt-2">
        {mine.length === 0 ? <p className="m-0 text-[13px] text-muted">No findings on this host yet.</p> : <span />}
        <Button size="sm" title="Add finding (F)" onClick={() => onOpenFinding("new")}>
          <Plus size={12} weight="light" aria-hidden /> Add finding
        </Button>
      </div>
      {mine.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {mine.map((f) => (
            <li key={f.id} className="border-b border-line">
              <button
                type="button"
                aria-label={`Open ${f.title}`}
                onClick={() => onOpenFinding(f)}
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
      <AttemptsList eid={engagementId} hostId={host.id} onOpenEntry={onOpenEntry} />
    </div>
  );
}
