import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { applicableGoals, currentStage, type FillInput } from "../../engines/checklist";
import { api } from "../../lib/api";
import type { Host } from "../../types/host";
import { Panel, Toggle } from "../../ui";
import { useHosts } from "../hosts/queries";
import { CommandList } from "./CommandList";
import { goalCommands } from "./goalCommands";
import { useChecklist, useChecklistMutations, useEngagementServices, useTunnels } from "./queries";

/** The host's current stage: its open goals, one-click Done/Doing, and the first filled command of each. */
export function NowPanel({ engagementId, host, onOpenGoal }: { engagementId: string; host: Host; onOpenGoal: (goalId: string) => void }) {
  const hostsQ = useHosts(engagementId);
  const engagement = useQuery({ queryKey: ["engagement", engagementId], queryFn: () => api.engagementGet(engagementId) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const { byOwner } = useChecklist(engagementId);
  const { servicesByHost, query: servicesQ } = useEngagementServices(engagementId);
  const { tunnels } = useTunnels(engagementId);
  const { setStatus } = useChecklistMutations(engagementId);

  const hosts = hostsQ.data;
  const eng = engagement.data;
  const applicable = useMemo(
    () => (hosts && eng ? applicableGoals(host, eng, hosts, servicesByHost) : []),
    [host, eng, hosts, servicesByHost],
  );

  const failed = hostsQ.error ?? engagement.error ?? servicesQ.error;
  if (failed) return <Panel title="Now" aria-label="Now"><p role="alert" className="m-0 text-xs text-warn">Couldn't load the checklist: {failed.message}</p></Panel>;
  if (!hosts || !eng || !servicesQ.data) return <Panel title="Now" aria-label="Now" />;

  const state = byOwner.get(host.id) ?? {};
  const stage = currentStage(state, applicable);
  const input: FillInput = {
    host, engagement: eng, hosts, servicesByHost, tunnels,
    attackerIp: settings.data?.attackerIp ?? "", listenerPort: settings.data?.listenerPort ?? "",
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
    <Panel title="Now" aria-label="Now">
      {!stage ? (
        <p className="m-0 text-xs text-muted">All stages done</p>
      ) : (
        <div className="flex flex-col gap-3">
          <h3 className="m-0 text-[13px] font-semibold text-fg">{stage.title}</h3>
          {open.length === 0 ? (
            <p className="m-0 text-xs text-muted">Nothing allowed in an exam sim; do it by hand</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {open.map(({ goal, commands }) => {
                const status = state[goal.id]?.status ?? "todo";
                const set = (next: "done" | "in_progress" | "todo") => setStatus.mutate({ ownerId: host.id, goalId: goal.id, status: next });
                return (
                  <li key={goal.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenGoal(goal.id)}
                        className="min-w-0 flex-1 cursor-default truncate bg-transparent p-0 text-left text-[13px] text-fg hover:underline"
                      >
                        {goal.title}
                      </button>
                      <div role="group" aria-label={`Now: ${goal.title}`} className="inline-flex shrink-0 gap-0.5">
                        <Toggle on={status === "in_progress"} onChange={(on) => set(on ? "in_progress" : "todo")}>Doing</Toggle>
                        <Toggle on={false} onChange={() => set("done")}>Done</Toggle>
                      </div>
                    </div>
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
