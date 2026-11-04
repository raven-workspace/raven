import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { applicableGoals, type FillInput } from "../../engines/checklist";
import { api } from "../../lib/api";
import type { Host } from "../../types/host";
import { Button, Input, Select } from "../../ui";
import { useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { goalCommands } from "./goalCommands";
import { GoalRow } from "./GoalRow";
import { useChecklist, useChecklistMutations, useEngagementServices, useHopMutations, useTunnels } from "./queries";

const KALI = "kali";
const EXAM_EMPTY = "Nothing allowed in an exam sim; do it by hand";

function ArrivedFrom({ host, hosts, onSave }: { host: Host; hosts: Host[]; onSave: (fromHostId: string | null, via: string) => Promise<void> }) {
  const [from, setFrom] = useState(KALI);
  const [via, setVia] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const options = [{ value: KALI, label: "Kali" }, ...hosts.filter((h) => h.id !== host.id).map((h) => ({ value: h.id, label: h.name }))];
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(from === KALI ? null : from, via.trim());
      setVia("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-fg-2">Arrived from</span>
      <div className="flex items-center gap-2">
        <Select aria-label="Arrived from" className="w-40" options={options} value={from} onValueChange={setFrom} />
        <Input aria-label="Via" placeholder="via (creds, exploit, share…)" value={via} onChange={(e) => setVia(e.target.value)} className="flex-1" />
        <Button variant="primary" disabled={saving || via.trim() === ""} onClick={() => void save()}>
          Save hop
        </Button>
      </div>
      {error && <p role="alert" className="m-0 text-xs text-warn">{error}</p>}
    </div>
  );
}

export function HostChecklist({ engagementId, host, onOpenEntry, focusGoal }: { engagementId: string; host: Host; onOpenEntry: (entryId: string) => void; focusGoal?: { id: string; n: number } }) {
  const hostsQ = useHosts(engagementId);
  const engagement = useQuery({ queryKey: ["engagement", engagementId], queryFn: () => api.engagementGet(engagementId) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const log = useLog(engagementId);
  const { byOwner } = useChecklist(engagementId);
  const { servicesByHost, query: servicesQ } = useEngagementServices(engagementId);
  const { tunnels } = useTunnels(engagementId);
  const { setStatus, setNotes } = useChecklistMutations(engagementId);
  const hops = useHopMutations(engagementId);

  /** The hop already created for the last Save, so a retry after a failed tick never duplicates it. */
  const createdHop = useRef<string>(undefined);

  const hosts = hostsQ.data;
  const eng = engagement.data;
  const groups = useMemo(
    () => (hosts && eng ? applicableGoals(host, eng, hosts, servicesByHost) : []),
    [host, eng, hosts, servicesByHost],
  );

  const failed = hostsQ.error ?? engagement.error ?? servicesQ.error;
  if (failed) return <p role="alert" className="py-3 text-xs text-warn">Couldn't load the checklist: {failed.message}</p>;
  if (!hosts || !eng || !servicesQ.data) return null;
  const state = byOwner.get(host.id) ?? {};
  const entries = log.data ?? [];
  const input: FillInput = {
    host, engagement: eng, hosts, servicesByHost, tunnels,
    attackerIp: settings.data?.attackerIp ?? "", listenerPort: settings.data?.listenerPort ?? "",
  };

  const commandsFor = (goalId: string) => goalCommands(goalId, input, eng);

  const recordHop = async (fromHostId: string | null, via: string) => {
    const key = `${fromHostId ?? KALI}|${via}`;
    if (createdHop.current !== key) {
      await hops.create.mutateAsync({ fromHostId, toHostId: host.id, via });
      createdHop.current = key;
    }
    await setStatus.mutateAsync({ ownerId: host.id, goalId: "h-foot-arrived", status: "done" });
    createdHop.current = undefined;
  };

  return (
    <div className="flex flex-col gap-6 py-3">
      {groups.map(({ stage, goals, hint }) => (
        <section key={stage.id} aria-label={stage.title} className="flex flex-col gap-2 border-t border-line-2 pt-5 first:border-t-0 first:pt-0">
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-label text-muted">{stage.title}</h3>
          {goals.length === 0 ? (
            <p className="m-0 text-xs text-muted">{hint}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {goals.map((g) => {
                const { commands, hadAny } = commandsFor(g.id);
                const s = state[g.id];
                return (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    focus={focusGoal?.id === g.id ? focusGoal.n : undefined}
                    state={s}
                    commands={commands}
                    evidence={(s?.evidence ?? []).map((ev) => {
                      const e = entries.find((x) => x.id === ev.entryId);
                      return { entryId: ev.entryId, label: e?.title ?? "", exists: !!e };
                    })}
                    emptyCommandsText={hadAny && commands.length === 0 ? EXAM_EMPTY : undefined}
                    onStatus={(goalId, status) => setStatus.mutate({ ownerId: host.id, goalId, status })}
                    onNotes={(goalId, notes) => setNotes.mutate({ ownerId: host.id, goalId, notes })}
                    onOpenEntry={onOpenEntry}
                  >
                    {g.id === "h-foot-arrived" && <ArrivedFrom host={host} hosts={hosts} onSave={recordHop} />}
                  </GoalRow>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
