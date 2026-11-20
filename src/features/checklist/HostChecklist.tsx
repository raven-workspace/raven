import { Fragment, useMemo, useRef, useState } from "react";
import { applicableGoals, currentStage, hostViewStages, loggedListenerPorts, type FillInput } from "../../engines/checklist";
import type { Host } from "../../types/host";
import { Button, Input, Select, fieldLabelClass, labelClass, queryState } from "../../ui";
import { COLUMN_LABELS } from "../hosts/columns";
import { useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { CredentialPicker } from "./CredentialPicker";
import { newCredLabels, useCredFill } from "./credPick";
import { useFilePickStore } from "./filePick";
import { usePortPickStore } from "./portPick";
import { goalCommands } from "./goalCommands";
import { shortHostName } from "../../lib/hostName";
import { GoalRow } from "./GoalRow";
import { useChecklist, useChecklistMutations } from "./queries";
import { useHopMutations, useTunnels } from "../network/queries";
import { useEngagementServices } from "../services/queries";
import { useSettings, settingsFill } from "../settings/queries";
import { useEngagement } from "../engagements/queries";
import { RavenError } from "../../types/errors";

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
      setError(RavenError.from(e).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="grid gap-1">
      <div className="grid grid-cols-[192px_minmax(0,1fr)_auto] items-end gap-2">
        <label className="grid gap-1">
          <span className={fieldLabelClass}>Arrived from</span>
          <Select aria-label="Arrived from" options={options} value={from} onValueChange={setFrom} />
        </label>
        <label className="grid min-w-0 gap-1">
          <span className={fieldLabelClass}>Via</span>
          <Input aria-label="Via" placeholder="creds, exploit, share…" value={via} onChange={(e) => setVia(e.target.value)} />
        </label>
        <Button variant="primary" disabled={saving || via.trim() === ""} onClick={() => void save()}>
          Save hop
        </Button>
      </div>
      {error && <p role="alert" className="m-0 text-meta text-warn">{error}</p>}
    </div>
  );
}

/**
 * The host's checklist. `scope: "next"` shows only the current stage's open steps (the Next tab); `"all"` every
 * stage, done steps included. Next hides done steps, so it says when any of them, in any stage, has new
 * credentials since it was done; `onShowFull` opens the full checklist where they are.
 */
export function HostChecklist({ engagementId, host, onOpenEntry, focusGoal, scope = "all", onShowFull }: {
  engagementId: string;
  host: Host;
  onOpenEntry: (entryId: string) => void;
  focusGoal?: { id: string; n: number };
  scope?: "all" | "next";
  onShowFull?: () => void;
}) {
  useFilePickStore((s) => s.file); // a chip pick refills the rows' commands
  usePortPickStore((s) => s.picks); // a port pick refills them too
  const hostsQ = useHosts(engagementId);
  const engagement = useEngagement(engagementId);
  const settings = useSettings();
  const log = useLog(engagementId);
  const { byOwner } = useChecklist(engagementId);
  const { servicesByHost, query: servicesQ } = useEngagementServices(engagementId);
  const { tunnels } = useTunnels(engagementId);
  const { setStatus, setNotes } = useChecklistMutations(engagementId);
  const hops = useHopMutations(engagementId);
  const creds = useCredFill(engagementId, host);

  /** The hop already created for the last Save, so a retry after a failed tick never duplicates it. */
  const createdHop = useRef<string>(undefined);

  const hosts = hostsQ.data;
  const eng = engagement.data;
  const groups = useMemo(
    () => (hosts && eng ? hostViewStages(applicableGoals(host, eng, hosts, servicesByHost)) : []),
    [host, eng, hosts, servicesByHost],
  );

  const loadState = queryState([hostsQ, engagement, servicesQ], "the checklist");
  if (loadState) return loadState;
  if (!hosts || !eng || !servicesQ.data) return null;
  const state = byOwner.get(host.id) ?? {};
  const entries = log.data ?? [];
  const input: FillInput = {
    host, engagement: eng, hosts, servicesByHost, tunnels,
    ...settingsFill(settings.data), cred: creds.cred,
    listenerPorts: loggedListenerPorts(entries),
  };

  const commandsFor = (goalId: string) => goalCommands(goalId, input, eng);
  const isOpen = (goalId: string) => {
    const s = state[goalId]?.status;
    return s === undefined || s === "todo" || s === "in_progress";
  };
  // Next is the host's current stage, its board column: earlier stages' open steps stay in the full checklist.
  const boardGroup = groups.find((g) => g.stage.id === host.boardColumn);
  const openHere = boardGroup ? boardGroup.goals.filter((g) => isOpen(g.id)) : [];
  const shown = scope === "all" ? groups : boardGroup && openHere.length > 0 ? [{ ...boardGroup, goals: openHere }] : [];
  const nothingNext =
    scope === "next" && shown.length === 0
      ? currentStage(state, groups)
        ? `Nothing open in ${boardGroup?.stage.title ?? COLUMN_LABELS[host.boardColumn]}. Earlier steps are in the full checklist.`
        : "All stages done"
      : undefined;

  const doneWithNewCreds =
    scope === "next"
      ? new Set(
          groups
            .flatMap((g) => g.goals)
            .filter((g) => state[g.id]?.status === "done" && newCredLabels(state[g.id]?.completedAt, creds.credentials).length > 0)
            .map((g) => g.id),
        ).size
      : 0;

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
    <div data-checklist-ready className="grid gap-6 py-3">
      <CredentialPicker credentials={creds.credentials} value={creds.cred} onChange={creds.pick} />
      {nothingNext && <p className="m-0 text-meta text-muted">{nothingNext}</p>}
      {doneWithNewCreds > 0 && onShowFull && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <span className="min-w-0 truncate text-meta text-fg-2">
            {doneWithNewCreds} done step{doneWithNewCreds === 1 ? " has" : "s have"} new credentials
          </span>
          <Button size="sm" onClick={onShowFull}>Show done steps</Button>
        </div>
      )}
      {shown.map(({ stage, goals, hint }) => (
        <section key={stage.id} aria-label={stage.title} className="grid gap-2 border-t border-line-2 pt-6 first:border-t-0 first:pt-0">
          <h3 className={`m-0 ${labelClass}`}>{stage.title}</h3>
          {goals.length === 0 ? (
            <p className="m-0 text-meta text-muted">{hint}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {goals.map((g, i) => {
                const { commands, hadAny } = commandsFor(g.id);
                const s = state[g.id];
                const heading = g.group && g.group !== goals[i - 1]?.group ? g.group : undefined;
                return (
                  <Fragment key={g.id}>
                  {heading && (
                    <li role="presentation" className="list-none pb-1 pt-3 first:pt-0">
                      <h4 className="m-0 text-meta font-medium text-muted-2">{heading}</h4>
                    </li>
                  )}
                  <GoalRow
                    goal={g}
                    focus={focusGoal?.id === g.id ? focusGoal.n : undefined}
                    state={s}
                    commands={commands}
                    evidence={(s?.evidence ?? []).map((ev) => {
                      const e = entries.find((x) => x.id === ev.entryId);
                      return { entryId: ev.entryId, label: e?.title ?? "", exists: !!e };
                    })}
                    emptyCommandsText={hadAny && commands.length === 0 ? EXAM_EMPTY : undefined}
                    newCredLabels={newCredLabels(s?.completedAt, creds.credentials)}
                    onStatus={(goalId, status) => setStatus.mutate({ ownerId: host.id, goalId, status })}
                    onNotes={(goalId, notes) => setNotes.mutate({ ownerId: host.id, goalId, notes })}
                    onOpenEntry={onOpenEntry}
                    hostName={shortHostName(host.name)}
                  >
                    {g.id === "h-foot-arrived" && <ArrivedFrom host={host} hosts={hosts} onSave={recordHop} />}
                  </GoalRow>
                  </Fragment>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
