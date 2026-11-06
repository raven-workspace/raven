import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { applicableGoals, currentStage, hostViewStages, type FillInput } from "../../engines/checklist";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import type { Host } from "../../types/host";
import type { ChecklistStatus } from "../../types/checklist";
import { Panel, labelClass } from "../../ui";
import { useHosts } from "../hosts/queries";
import { CommandList } from "./CommandList";
import { FileChip } from "./FileChip";
import { useFilePickStore } from "./filePick";
import { CredentialPicker } from "./CredentialPicker";
import { StatusToggles } from "./GoalRow";
import { useCredFill } from "./credPick";
import { goalCommands } from "./goalCommands";
import { useChecklist, useChecklistMutations, useEngagementServices, useTunnels } from "./queries";

/** The host's current stage: its open goals, one-click Done/Doing, and the first filled command of each. */
export function NowPanel({ engagementId, host, onOpenGoal }: { engagementId: string; host: Host; onOpenGoal: (goalId: string) => void }) {
  useFilePickStore((s) => s.file); // a chip pick refills this panel's commands
  const hostsQ = useHosts(engagementId);
  const engagement = useQuery({ queryKey: ["engagement", engagementId], queryFn: () => api.engagementGet(engagementId) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const { byOwner } = useChecklist(engagementId);
  const { servicesByHost, query: servicesQ } = useEngagementServices(engagementId);
  const { tunnels } = useTunnels(engagementId);
  const { setStatus } = useChecklistMutations(engagementId);
  const creds = useCredFill(engagementId, host);

  const hosts = hostsQ.data;
  const eng = engagement.data;
  const applicable = useMemo(
    () => (hosts && eng ? hostViewStages(applicableGoals(host, eng, hosts, servicesByHost)) : []),
    [host, eng, hosts, servicesByHost],
  );

  const failed = hostsQ.error ?? engagement.error ?? servicesQ.error;
  if (failed) return <Panel title="Now" aria-label="Now" className="shrink-0"><p role="alert" className="m-0 text-xs text-warn">Couldn't load the checklist: {failed.message}</p></Panel>;
  if (!hosts || !eng || !servicesQ.data) return <Panel title="Now" aria-label="Now" className="shrink-0" />;

  const state = byOwner.get(host.id) ?? {};
  const stage = currentStage(state, applicable);
  const input: FillInput = {
    host, engagement: eng, hosts, servicesByHost, tunnels,
    attackerIp: settings.data?.attackerIp ?? "", kaliUser: settings.data?.kaliUser, listenerPort: settings.data?.listenerPort ?? "", cred: creds.cred,
  };
  const open = (stage ? (applicable.find((a) => a.stage.id === stage.id)?.goals ?? []) : [])
    .filter((g) => {
      const s = state[g.id]?.status;
      return s === undefined || s === "todo" || s === "in_progress";
    })
    .map((g) => ({ goal: g, ...goalCommands(g.id, input, eng) }))
    // Exam sims: a goal whose every command is banned has nothing to show here.
    .filter((x) => !(x.hadAny && x.commands.length === 0));

  return (
    <Panel aria-label="Now" className="shrink-0">
      {/* Label and stage on one line: "NOW  Enumerate". */}
      <header className="mb-1 flex min-h-5 items-baseline gap-2 border-b border-line pb-3">
        <h2 className={cx(labelClass, "m-0")}>Now</h2>
        {stage && <h3 className="m-0 text-[13px] font-semibold text-fg">{stage.title}</h3>}
      </header>
      {!stage ? (
        <p className="m-0 text-xs text-muted">All stages done</p>
      ) : (
        <div className="flex flex-col gap-3">
          <CredentialPicker credentials={creds.credentials} value={creds.cred} onChange={creds.pick} />
          {open.length === 0 ? (
            <p className="m-0 text-xs text-muted">Nothing allowed in an exam sim; do it by hand</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {open.map(({ goal, commands }) => {
                const status = state[goal.id]?.status ?? "todo";
                const set = (next: ChecklistStatus) => setStatus.mutate({ ownerId: host.id, goalId: goal.id, status: next });
                return (
                  <li key={goal.id} className="flex flex-col gap-2 py-3 last:pb-1">
                    <button
                      type="button"
                      onClick={() => onOpenGoal(goal.id)}
                      className="cursor-default bg-transparent p-0 text-left text-[13px] text-fg hover:underline"
                    >
                      {goal.title}
                    </button>
                    {/* The checklist's own status control, on its own line: the title gets the full width and wraps. */}
                    <div className="mb-1 self-start">
                      <StatusToggles label={`Now: ${goal.title}`} status={status} onStatus={set} />
                    </div>
                    {commands[0] && <FileChip commands={[commands[0]]} />}
                    {commands[0] && <CommandList commands={[commands[0]]} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
