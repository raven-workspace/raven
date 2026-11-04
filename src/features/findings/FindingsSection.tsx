import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { sortFindingsBySeverity } from "../../engines/findings";
import type { Finding } from "../../types/findings";
import { Button, Chip, EmptyState, labelClass } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { useEngagementServices } from "../checklist/queries";
import { hostLabel } from "../credentials/AccessGrants";
import { useHosts } from "../hosts/queries";
import { FindingEditor } from "./FindingEditor";
import { useFindingMutations, useFindings } from "./queries";

/** Critical and high use the warn colour; the rest stay neutral. */
export function SeverityChip({ severity }: { severity: Finding["severity"] }) {
  if (!severity) return <Chip>unrated</Chip>;
  return <Chip variant={severity === "critical" || severity === "high" ? "warn" : "default"}>{severity}</Chip>;
}

export function FindingsSection() {
  const { id = "" } = useParams();
  const hostsQ = useHosts(id);
  const findingsQ = useFindings(id);
  const { servicesByHost, query: servicesQ } = useEngagementServices(id);
  const { remove } = useFindingMutations(id);
  const [editor, setEditor] = useState<{ edit?: Finding } | null>(null);
  const [deleting, setDeleting] = useState<Finding>();
  const sorted = useMemo(() => sortFindingsBySeverity(findingsQ.data ?? []), [findingsQ.data]);

  const failed = hostsQ.error ?? findingsQ.error ?? servicesQ.error;
  if (failed) return <p role="alert" className="py-3 text-xs text-warn">Couldn't load findings: {failed.message}</p>;
  if (!hostsQ.data || !findingsQ.data || !servicesQ.data) return null;
  const hosts = hostsQ.data;
  const names = (f: Finding) => f.hostIds.map((hid) => hostLabel(hosts.find((h) => h.id === hid))).join(", ");

  return (
    <section aria-label="Findings" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className={`m-0 ${labelClass}`}>Findings <span className="tabular-nums">{sorted.length}</span></h3>
        <Button variant="primary" onClick={() => setEditor({})}>Add finding</Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No findings yet" />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {sorted.map((f) => (
            <li key={f.id} className="flex items-center gap-3 border-b border-line py-2">
              <span className="w-[72px] shrink-0"><SeverityChip severity={f.severity} /></span>
              <span className="min-w-0 flex-1">
                <span data-testid="finding-title" className="block truncate text-[13px] text-fg">{f.title}</span>
                {f.hostIds.length > 0 && <span className="block truncate text-[11px] text-muted">{names(f)}</span>}
              </span>
              <span className="text-xs text-fg-2">{f.status}</span>
              <span className="w-8 text-right font-mono text-xs tabular-nums text-fg-2">{f.cvssScore !== null ? f.cvssScore.toFixed(1) : ""}</span>
              <span className="flex gap-1.5">
                <Button size="sm" aria-label={`Edit ${f.title}`} onClick={() => setEditor({ edit: f })}>Edit</Button>
                <Button size="sm" variant="danger" aria-label={`Delete ${f.title}`} onClick={() => setDeleting(f)}>Delete</Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editor && (
        <FindingEditor eid={id} hosts={hosts} servicesByHost={servicesByHost} edit={editor.edit} onClose={() => setEditor(null)} />
      )}
      {deleting && (
        <ConfirmDelete
          title={`Delete ${deleting.title}?`}
          pending={remove.isPending}
          error={remove.error?.message}
          label="Delete finding"
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) })}
        />
      )}
    </section>
  );
}
