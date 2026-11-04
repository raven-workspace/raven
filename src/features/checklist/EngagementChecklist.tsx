import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  AD_PLAYBOOKS,
  ENGAGEMENT_SETUP,
  adHosts,
  engagementFacts,
  findDcHost,
  goalApplies,
  type ChecklistGoal,
  type FillInput,
} from "../../engines/checklist";
import { api } from "../../lib/api";
import type { Host } from "../../types/host";
import { Button, EmptyState } from "../../ui";
import { useHosts } from "../hosts/queries";
import { sectionPath } from "../engagements/sections";
import { useLog } from "../log/queries";
import { goalCommands } from "./goalCommands";
import { GoalRow } from "./GoalRow";
import { HopsPanel } from "./HopsPanel";
import { PlaybookSection } from "./PlaybookSection";
import { useChecklist, useChecklistMutations, useEngagementServices, useHops, useTunnels } from "./queries";
import { loadTickContext, tickFromLog } from "./ticks";
import { TunnelsPanel } from "./TunnelsPanel";

const EXAM_EMPTY = "Nothing allowed in an exam sim; do it by hand";
const CREDS_NOTE = "Opens automatically once credentials arrive (build step 4)";

export function EngagementChecklist() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const hostsQ = useHosts(id);
  const engagement = useQuery({ queryKey: ["engagement", id], queryFn: () => api.engagementGet(id) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const log = useLog(id);
  const { byOwner } = useChecklist(id);
  const { servicesByHost, query: servicesQ } = useEngagementServices(id);
  const { tunnels } = useTunnels(id);
  const { hops } = useHops(id);
  const { setStatus, setNotes } = useChecklistMutations(id);
  const [tick, setTick] = useState<{ ticking: boolean; message?: string; error?: string }>({ ticking: false });

  const hosts = hostsQ.data;
  const eng = engagement.data;
  const ad = useMemo(() => (hosts ? adHosts(hosts, servicesByHost) : []), [hosts, servicesByHost]);

  const failed = hostsQ.error ?? engagement.error ?? servicesQ.error;
  if (failed) return <EmptyState title="Couldn't load the checklist" body={failed.message} />;
  if (!hosts || !eng || !servicesQ.data) return null;

  const hasAd = ad.length > 0;
  const facts = engagementFacts(eng, hosts, servicesByHost);
  const setup = ENGAGEMENT_SETUP.filter((g) => goalApplies(g, facts));
  const state = byOwner.get(eng.id) ?? {};
  const entries = log.data ?? [];

  // Engagement goals have no host of their own: fill against the DC, else show each template unfilled.
  const dc = findDcHost(hosts, servicesByHost);
  const stand: Host = {
    ...(dc ?? { name: "", ip: null, os: null, engagementId: eng.id, boardColumn: "enumerate", boardManual: false, dualHomed: false, boardDerived: null, access: "none", createdAt: 0, updatedAt: 0 }),
    id: eng.id,
  };
  const input: FillInput = {
    host: stand, engagement: eng, hosts, servicesByHost, tunnels,
    attackerIp: settings.data?.attackerIp ?? "", listenerPort: settings.data?.listenerPort ?? "",
  };
  // The Log section has no deep link to one entry yet: open the section.
  const openEntry = () => void navigate(sectionPath(id, "log"));

  const row = (g: ChecklistGoal) => {
    const { commands, hadAny } = goalCommands(g.id, input, eng);
    const s = state[g.id];
    return (
      <GoalRow
        key={g.id}
        goal={g}
        state={s}
        commands={commands}
        evidence={(s?.evidence ?? []).map((ev) => {
          const e = entries.find((x) => x.id === ev.entryId);
          return { entryId: ev.entryId, label: e?.title ?? "", exists: !!e };
        })}
        emptyCommandsText={hadAny && commands.length === 0 ? EXAM_EMPTY : undefined}
        onStatus={(goalId, status) => setStatus.mutate({ ownerId: eng.id, goalId, status })}
        onNotes={(goalId, notes) => setNotes.mutate({ ownerId: eng.id, goalId, notes })}
        onOpenEntry={openEntry}
      />
    );
  };

  const adIds = new Set(ad.map((h) => h.id));
  const hopToAd = hops.some((h) => adIds.has(h.toHostId));
  const opens: Record<string, boolean> = { nocreds: hasAd, user: false, da: hopToAd };

  const runTick = async () => {
    setTick({ ticking: true });
    try {
      const r = await tickFromLog(id, await loadTickContext(id));
      setTick({ ticking: false, message: r.message });
    } catch (e) {
      setTick({ ticking: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <section aria-label="Engagement checklist" className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Button disabled={tick.ticking} onClick={() => void runTick()}>Tick from log</Button>
        <p role="status" className="m-0 text-xs text-fg-2">{tick.message}</p>
        {tick.error && <p role="alert" className="m-0 text-xs text-warn">{tick.error}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-label text-muted">Setup</h3>
        <ul className="m-0 list-none p-0">{setup.map(row)}</ul>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-label text-muted">Active Directory</h3>
        {AD_PLAYBOOKS.map((p) => (
          <PlaybookSection key={p.id} title={p.title} opensWhen={p.opensWhen} defaultOpen={opens[p.id] ?? false} note={p.id === "nocreds" ? undefined : CREDS_NOTE}>
            {p.goals.map(row)}
          </PlaybookSection>
        ))}
      </div>

      <TunnelsPanel engagementId={id} hosts={hosts} tunnels={tunnels} />
      <HopsPanel engagementId={id} hosts={hosts} hops={hops} />
    </section>
  );
}
