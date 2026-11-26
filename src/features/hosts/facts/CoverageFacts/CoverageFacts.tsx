import { useMemo } from "react";
import { applicableGoals, currentStage, hostViewStages } from "../../../../engines/checklist/index";
import { cx } from "../../../../lib/cx";
import { queryState } from "../../../../ui/index";
import type { ItemState } from "../../../../types/checklist";
import type { Host } from "../../../../types/host";
import { useChecklist } from "../../../checklist/queries";
import { useEngagementServices } from "../../../services/queries";
import { COLUMN_LABELS } from "../../columns";
import { useHosts } from "../../queries";
import { FactGroup, SummaryCell } from "../FactGroup/FactGroup";
import { useEngagement } from "../../../engagements/queries";
import "./CoverageFacts.scss";

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
  const engagement = useEngagement(engagementId);
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
  const summary = failed ? (
    <span>couldn't load</span>
  ) : !hosts || !eng || !servicesQ.data ? undefined : now ? (
    <SummaryCell label={now.stage.title} shrink="label">{now.done}/{now.applicable} done</SummaryCell>
  ) : currentStage(state, stages) ? (
    <span>{current?.title ?? COLUMN_LABELS[host.boardColumn]}</span>
  ) : (
    <span>all stages done</span>
  );

  return (
    <FactGroup title="Coverage" summary={summary} open={open} onToggle={onToggle}>
      {failed ? (
        queryState([hostsQ, engagement, servicesQ, checklistQ], "the checklist")
      ) : (
        <ul className="coverage-facts">
          {rows.map((r) => (
            <li key={r.stage.id} className="coverage-facts__row">
              <span className={cx("coverage-facts__stage", r.stage.id === current?.id && "coverage-facts__stage--current")}>{r.stage.title}</span>
              <span className="coverage-facts__count">{r.done}/{r.applicable}</span>
              <span aria-hidden className="coverage-facts__bar">
                <span
                  className={cx("coverage-facts__fill", r.done === r.applicable && "coverage-facts__fill--done")}
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
