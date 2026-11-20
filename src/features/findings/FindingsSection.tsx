import { PencilSimple, Trash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { sortFindingsBySeverity } from "../../engines/findings";
import type { Finding } from "../../types/findings";
import { ActionCell, Button, Chip, EmptyState, IconButton, labelClass, queryState } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { useHosts } from "../hosts/queries";
import { sectionPath } from "../engagements/sections";
import { AttemptsList } from "./AttemptsList";
import { FindingSplit } from "./FindingSplit";
import { useFindingMutations, useFindings } from "./queries";
import { hostLabel } from "../../lib/hostName";
import "./FindingsSection.scss";

/** Critical and high use the warn colour; the rest stay neutral. */
export function SeverityChip({ severity }: { severity: Finding["severity"] }) {
  if (!severity) return <Chip>unrated</Chip>;
  return <Chip variant={severity === "critical" || severity === "high" ? "warn" : "default"}>{severity}</Chip>;
}

export function FindingsSection() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const hostsQ = useHosts(id);
  const findingsQ = useFindings(id);
  const { remove } = useFindingMutations(id);
  const [editor, setEditor] = useState<{ edit?: Finding } | null>(null);
  const [deleting, setDeleting] = useState<Finding>();
  const sorted = useMemo(() => sortFindingsBySeverity(findingsQ.data ?? []), [findingsQ.data]);

  const state = queryState([hostsQ, findingsQ], "findings");
  if (state || !hostsQ.data || !findingsQ.data) return state;
  const hosts = hostsQ.data;
  if (editor) {
    // The same split as the host page: with one affected host its context shows; otherwise the switcher or the engagement's.
    const only = editor.edit?.hostIds.length === 1 ? editor.edit.hostIds[0]! : null;
    return (
      <div className="findings-section__split">
        <FindingSplit key={editor.edit?.id ?? "new"} eid={id} hostId={only} edit={editor.edit ?? "new"} onClose={() => setEditor(null)} />
      </div>
    );
  }
  const names = (f: Finding) => f.hostIds.map((hid) => hostLabel(hosts.find((h) => h.id === hid))).join(", ");

  return (
    <section aria-label="Findings" className="findings-section">
      <div className="findings-section__header">
        <h3 className={labelClass}>Findings <span className="findings-section__count">{sorted.length}</span></h3>
        <Button variant="primary" onClick={() => setEditor({})}>Add finding</Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No findings yet" />
      ) : (
        // One grid for the header and the rows, so every column lines up with its name.
        <div className="findings-section__table">
          <div aria-hidden className={`findings-section__head ${labelClass}`}>
            <span>Severity</span>
            <span>Finding</span>
            <span>Status</span>
            <span className="findings-section__head-score">CVSS</span>
            <span />
          </div>
          <ul className="findings-section__rows">
            {sorted.map((f) => (
              <li key={f.id} className="findings-section__row">
                <span className="findings-section__severity"><SeverityChip severity={f.severity} /></span>
                <span className="findings-section__main">
                  {/* The title opens the finding: the whole name is the target, not only the pencil. */}
                  <button
                    type="button"
                    data-testid="finding-title"
                    title={f.title}
                    onClick={() => setEditor({ edit: f })}
                    className="findings-section__title"
                  >
                    {f.title}
                  </button>
                  {f.hostIds.length > 0 && (
                    <span className="findings-section__hosts" title={names(f)}>
                      <span className="findings-section__host">{hostLabel(hosts.find((h) => h.id === f.hostIds[0]))}</span>
                      {f.hostIds.length > 1 && <span>{`+${f.hostIds.length - 1}`}</span>}
                    </span>
                  )}
                </span>
                {/* A draft is still unconfirmed, so it sits a step quieter than confirmed and reported. */}
                <span className={f.status === "draft" ? "findings-section__status findings-section__status--draft" : "findings-section__status"}>{f.status}</span>
                <span className="findings-section__score">{f.cvssScore !== null ? f.cvssScore.toFixed(1) : ""}</span>
                {/* 28px buttons centred on the 20px first line. */}
                <span className="findings-section__actions">
                  <ActionCell>
                    <IconButton icon={PencilSimple} label={`Edit ${f.title}`} onClick={() => setEditor({ edit: f })} />
                    <IconButton icon={Trash} tone="destructive" label={`Delete ${f.title}`} onClick={() => setDeleting(f)} />
                  </ActionCell>
                </span>
              </li>
            ))}
          </ul>
        </div>
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
      <AttemptsList eid={id} onOpenEntry={() => void navigate(sectionPath(id, "log"))} />
    </section>
  );
}
