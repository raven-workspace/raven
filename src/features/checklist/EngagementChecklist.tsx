import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  AD_PLAYBOOKS,
  ENGAGEMENT_SETUP,
  PIVOT_GOALS,
  LATERAL_MOVEMENT_GOALS,
  engagementFacts,
  findDcHost,
  goalApplies,
  type ChecklistGoal,
  type FillInput,
} from "../../engines/checklist";
import { playbookTriggers } from "../../engines/credentials/state";
import { api } from "../../lib/api";
import type { Host } from "../../types/host";
import { Button } from "../../ui";
import { CleanupPanel } from "../cleanup/CleanupPanel";
import { EngagementStuckCheck } from "../stuck/StuckView";
import { useHosts } from "../hosts/queries";
import { sectionPath } from "../engagements/sections";
import { useCredAttempts, useCredentials } from "../credentials/queries";
import { useLog } from "../log/queries";
import { AccessFlags } from "./AccessFlags";
import { CredentialPicker } from "./CredentialPicker";
import { newCredLabels, useCredFill } from "./credPick";
import { goalCommands } from "./goalCommands";
import { GoalRow } from "./GoalRow";
import { HopsPanel } from "./HopsPanel";
import { PlaybookSection } from "./PlaybookSection";
import { checklistKey, useChecklist, useChecklistMutations, useEngagementServices, useHops, useTunnels } from "./queries";
import { loadTickContext, tickFromLog } from "./ticks";
import { TunnelsPanel } from "./TunnelsPanel";

/** Sub-heading above the first row of each group. */
const GroupHeading = ({ children }: { children: ReactNode }) => (
  <li role="presentation" className="list-none pb-1 pt-3 first:pt-0">
    <h4 className="m-0 text-[11px] font-medium tracking-label text-faint">{children}</h4>
  </li>
);

const EXAM_EMPTY = "Nothing allowed in an exam sim; do it by hand";

export function EngagementChecklist() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hostsQ = useHosts(id);
  const engagement = useQuery({ queryKey: ["engagement", id], queryFn: () => api.engagementGet(id) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const log = useLog(id);
  const { byOwner } = useChecklist(id);
  const { servicesByHost, query: servicesQ } = useEngagementServices(id);
  const { tunnels } = useTunnels(id);
  const { hops } = useHops(id);
  const credentials = useCredentials(id).data ?? [];
  const attempts = useCredAttempts(id).data ?? [];
  const creds = useCredFill(id, { id }, "engagement");
  const { setStatus, setNotes } = useChecklistMutations(id);
  const location = useLocation();
  // A Stuck check line arrives with the pivot goal and host to focus; cleared below so back/forward does not repeat it.
  const arrived = (location.state as { goalId?: string; hostId?: string } | null) ?? null;
  const [focus, setFocus] = useState<{ goalId: string; hostId?: string; n: number }>();
  const [seenKey, setSeenKey] = useState<string>();
  // Every new arrival (even on this already-mounted route) is a fresh request: the counter re-expands the section and row.
  if (arrived?.goalId && location.key !== seenKey) {
    setSeenKey(location.key);
    setFocus({ goalId: arrived.goalId, hostId: arrived.hostId, n: (focus?.n ?? 0) + 1 });
  }
  const arrivedGoal = arrived?.goalId;
  useEffect(() => {
    if (arrivedGoal) void navigate(location.pathname, { replace: true, state: null });
  }, [arrivedGoal, location.pathname, navigate]);
  const [tick, setTick] = useState<{ ticking: boolean; message?: string; error?: string }>({ ticking: false });

  const hosts = hostsQ.data;
  const eng = engagement.data;

  const failed = hostsQ.error ?? engagement.error ?? servicesQ.error ?? settings.error ?? log.error;
  if (failed) return <p role="alert" className="py-3 text-xs text-warn">Couldn't load the engagement checklist: {failed.message}</p>;
  if (!hosts || !eng || !servicesQ.data) return null;

  const facts = engagementFacts(eng, hosts, servicesByHost);
  const setup = ENGAGEMENT_SETUP.filter((g) => goalApplies(g, facts));
  const state = byOwner.get(eng.id) ?? {};
  const entries = log.data ?? [];

  // Engagement goals have no host of their own: fill against the DC, else show each template unfilled.
  const dc = findDcHost(hosts, servicesByHost);
  const stand: Host = {
    ...(dc ?? { name: "", ip: null, os: null, engagementId: eng.id, boardColumn: "information-gathering", boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 0, updatedAt: 0 }),
    id: eng.id,
  };
  const input: FillInput = {
    host: stand, engagement: eng, hosts, servicesByHost, tunnels,
    attackerIp: settings.data?.attackerIp ?? "", listenerPort: settings.data?.listenerPort ?? "", cred: creds.cred,
  };
  // The Log section has no deep link to one entry yet: open the section.
  const openEntry = () => void navigate(sectionPath(id, "log"));

  /** One goal row. A pivot step belongs to its dual-homed host: filled against that host, state and writes keyed on it. */
  const row = (g: ChecklistGoal, owner?: Host) => {
    const ownerId = owner?.id ?? eng.id;
    const rowInput = owner ? { ...input, host: owner } : input;
    const { commands, hadAny } = goalCommands(g.id, rowInput, eng);
    const s = (owner ? byOwner.get(owner.id) ?? {} : state)[g.id];
    const focused = focus?.goalId === g.id && (focus.hostId === undefined || focus.hostId === owner?.id);
    return (
      <GoalRow
        key={`${ownerId}:${g.id}`}
        goal={g}
        focus={focused ? focus.n : undefined}
        state={s}
        commands={commands}
        evidence={(s?.evidence ?? []).map((ev) => {
          const e = entries.find((x) => x.id === ev.entryId);
          return { entryId: ev.entryId, label: e?.title ?? "", exists: !!e };
        })}
        emptyCommandsText={hadAny && commands.length === 0 ? EXAM_EMPTY : undefined}
        newCredLabels={newCredLabels(s?.completedAt, credentials)}
        onStatus={(goalId, status) => setStatus.mutate({ ownerId, goalId, status })}
        onNotes={(goalId, notes) => setNotes.mutate({ ownerId, goalId, notes })}
        onOpenEntry={openEntry}
      />
    );
  };
  /** Rows with a heading above each new group. */
  const grouped = (goals: ChecklistGoal[]) =>
    goals.map((g, i) => (
      <Fragment key={g.id}>
        {g.group && g.group !== goals[i - 1]?.group && <GroupHeading>{g.group}</GroupHeading>}
        {row(g)}
      </Fragment>
    ));
  const dualHomed = hosts.filter((h) => h.dualHomed === true);

  const opens = playbookTriggers({ engagement: eng, hosts, servicesByHost, credentials, attempts, hops });

  const runTick = async () => {
    setTick({ ticking: true });
    try {
      const r = await tickFromLog(id, await loadTickContext(id));
      setTick({ ticking: false, message: r.message });
      void qc.invalidateQueries({ queryKey: checklistKey(id) });
      void qc.invalidateQueries({ queryKey: ["hosts", id] });
      void qc.invalidateQueries({ queryKey: ["progress"] });
    } catch (e) {
      setTick({ ticking: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <section aria-label="Engagement checklist" className="flex flex-col gap-5">
      <EngagementStuckCheck engagementId={id} />

      <div className="flex items-center gap-3">
        <Button disabled={tick.ticking} onClick={() => void runTick()}>Tick from log</Button>
        <p role="status" className="m-0 text-xs text-fg-2">{tick.message}</p>
        {tick.error && <p role="alert" className="m-0 text-xs text-warn">{tick.error}</p>}
      </div>

      <CredentialPicker credentials={creds.credentials} value={creds.cred} onChange={creds.pick} />

      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-label text-muted">Setup</h3>
        <ul className="m-0 list-none p-0">{grouped(setup)}</ul>
      </div>

      <AccessFlags engagementId={id} hosts={hosts} attempts={attempts} credentials={credentials} />

      <div className="flex flex-col gap-3">
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-label text-muted">Active Directory</h3>
        {AD_PLAYBOOKS.map((p) => (
          <PlaybookSection key={p.id} title={p.title} opensWhen={p.opensWhen} defaultOpen={opens[p.id]}>
            {p.goals.map((g) => row(g))}
          </PlaybookSection>
        ))}
      </div>

      <PlaybookSection
        title="Lateral movement"
        opensWhen="A host is dual-homed, or a credential hasn't been tried everywhere"
        defaultOpen={opens.lateral}
        openRequest={focus?.n}
      >
        {dualHomed.map((h) => (
          <Fragment key={h.id}>
            <GroupHeading>Behind {h.name}</GroupHeading>
            {PIVOT_GOALS.map((g) => row(g, h))}
          </Fragment>
        ))}
        {grouped(LATERAL_MOVEMENT_GOALS)}
      </PlaybookSection>

      <TunnelsPanel engagementId={id} hosts={hosts} tunnels={tunnels} />
      <HopsPanel engagementId={id} hosts={hosts} hops={hops} />

      <CleanupPanel engagementId={id} hosts={hosts} entries={entries} domain={eng.domain} />
    </section>
  );
}
