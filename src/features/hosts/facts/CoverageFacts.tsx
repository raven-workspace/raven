import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { applicableGoals, currentStage, hostViewStages } from "../../../engines/checklist";
import { api } from "../../../lib/api";
import { cx } from "../../../lib/cx";
import type { ItemState } from "../../../types/checklist";
import type { Host } from "../../../types/host";
import { useChecklist, useEngagementServices } from "../../checklist/queries";
import { COLUMN_LABELS } from "../columns";
import { useHosts } from "../queries";
import { FactGroup } from "./FactGroup";

/** Steps done out of the ones that apply (N/A steps don't count against the stage). */
function tally(goalIds: string[], state: Record<string, ItemState | undefined>) {
  const applicable = goalIds.filter((id) => state[id]?.status !== "na");
  return { done: applicable.filter((id) => state[id]?.status === "done").length, applicable: applicable.length };
}

/** Checklist coverage per stage: how far each stage of this host has got. */
export function CoverageFacts({ engagementId, host, open, onToggle }: {
  engagementId: string;
  host: Host;
  open: boolean;
  onToggle: () => void;
}) {
  const hostsQ = useHosts(engagementId);
  const engagement = useQuery({ queryKey: ["engagement", engagementId], queryFn: () => api.engagementGet(engagementId) });
  const { byOwner, query: checklistQ } = useChecklist(engagementId);
  const { servicesByHost, query: servicesQ } = useEngagementServices(engagementId);
  const hosts = hostsQ.data;
  const eng = engagement.data;
  const stages = useMemo(
    () => (hosts && eng ? hostViewStages(applicableGoals(host, eng, hosts, servicesByHost)) : []),
    [host, eng, hosts, servicesByHost],
  );
  const failed = hostsQ.error ?? engagement.error ?? servicesQ.error ?? checklistQ.error;
  const state = byOwner.get(host.id) ?? {};
  // The current stage is the board column, as on the Next tab.
  const current = currentStage(state, stages) ? stages.find((s) => s.stage.id === host.boardColumn)?.stage : undefined;
  const rows = stages
    .filter((s) => s.goals.length > 0)
    .map((s) => ({ stage: s.stage, ...tally(s.goals.map((g) => g.id), state) }));
  const now = rows.find((r) => r.stage.id === current?.id);
  const summary = failed
    ? "Coverage · couldn't load"
    : !hosts || !eng || !servicesQ.data
      ? "Coverage"
      : now
        ? `Coverage · ${now.stage.title} ${now.done}/${now.applicable}`
        : currentStage(state, stages)
          ? `Coverage · ${current?.title ?? COLUMN_LABELS[host.boardColumn]}`
          : "Coverage · all stages done";

  return (
    <FactGroup title="Coverage" summary={summary} open={open} onToggle={onToggle}>
      {failed ? (
        <p role="alert" className="m-0 text-xs text-warn">Couldn't load the checklist: {failed.message}</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 p-0 text-[13px]">
          {rows.map((r) => (
            <li key={r.stage.id} className="col-span-2 grid grid-cols-subgrid items-center">
              <span className={cx("min-w-0 truncate", r.stage.id === current?.id ? "text-fg" : "text-muted")}>{r.stage.title}</span>
              <span className="font-mono text-xs text-fg-2">{r.done}/{r.applicable}</span>
              <span aria-hidden className="col-span-2 h-0.5 overflow-hidden rounded-full bg-line">
                <span
                  className={cx("block h-full", r.done === r.applicable ? "bg-accent" : "bg-fg-2")}
                  style={{ width: `${r.applicable === 0 ? 100 : Math.round((r.done / r.applicable) * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </FactGroup>
  );
}
