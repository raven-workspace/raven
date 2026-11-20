import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  AD_PLAYBOOKS,
  ENGAGEMENT_SETUP,
  PIVOT_GOALS,
  LATERAL_MOVEMENT_GOALS,
  engagementFacts,
  dcForFill,
  goalApplies,
  type ChecklistGoal,
  type FillInput,
} from "../../engines/checklist";
import { playbookTriggers } from "../../engines/credentials/state";
import type { Host } from "../../types/host";
import { Button, labelClass, queryState } from "../../ui";
import { CleanupPanel } from "../cleanup/CleanupPanel";
import { EngagementStuckCheck } from "../stuck/StuckView";
import { hostsKey, useHosts } from "../hosts/queries";
import { sectionPath } from "../engagements/sections";
import { useCredAttempts, useCredentials } from "../credentials/queries";
import { useLog } from "../log/queries";
import { AccessFlags } from "./AccessFlags";
import { CredentialPicker } from "./CredentialPicker";
import { newCredLabels, useCredFill } from "./credPick";
import { useFilePickStore } from "./filePick";
import { usePortPickStore } from "./portPick";
import { goalCommands } from "./goalCommands";
import { shortHostName } from "../../lib/hostName";
import { GoalRow } from "./GoalRow";
import { PlaybookSection } from "./PlaybookSection";
import { checklistKey, useChecklist, useChecklistMutations } from "./queries";
import { useHops, useTunnels } from "../network/queries";
import { useEngagementServices } from "../services/queries";
import { loadTickContext, tickFromLog } from "./ticks";
import { useSettings, settingsFill } from "../settings/queries";
import { useEngagement } from "../engagements/queries";
import { RavenError } from "../../types/errors";
import { blankHost } from "../hosts/blankHost";

/** Sub-heading above the first row of each group. */
const GroupHeading = ({ children }: { children: ReactNode }) => (
  <li role="presentation" className="list-none pb-1 pt-3 first:pt-0">
    <h4 className="m-0 text-meta font-medium text-muted-2">{children}</h4>
  </li>
);

const EXAM_EMPTY = "Nothing allowed in an exam sim; do it by hand";

export function EngagementChecklist() {
  useFilePickStore((s) => s.file); // a chip pick refills the rows' commands
  usePortPickStore((s) => s.picks); // a port pick refills them too
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hostsQ = useHosts(id);
  const engagement = useEngagement(id);
  const settings = useSettings();
  const log = useLog(id);
  const { byOwner } = useChecklist(id);
  const { servicesByHost, query: servicesQ } = useEngagementServices(id);
  const { tunnels } = useTunnels(id);
  const { hops } = useHops(id);
  const credentials = useCredentials(id).data ?? [];
  const attempts = useCredAttempts(id).data ?? [];
  const creds = useCredFill(id, { id }, "engagement");
  const { setStatus, setNotes } = useChecklistMutations(id);
  const [tick, setTick] = useState<{ ticking: boolean; message?: string; error?: string }>({ ticking: false });

  const hosts = hostsQ.data;
  const eng = engagement.data;

  const loadState = queryState([hostsQ, engagement, servicesQ, settings, log], "the engagement checklist");
  if (loadState || !hosts || !eng || !servicesQ.data) return loadState;

  const facts = engagementFacts(eng, hosts, servicesByHost);
  const setup = ENGAGEMENT_SETUP.filter((g) => goalApplies(g, facts));
  const state = byOwner.get(eng.id) ?? {};
  const entries = log.data ?? [];

  // Engagement goals have no host of their own: fill against the DC, else show each template unfilled.
  const dc = dcForFill(hosts, servicesByHost);
  const stand: Host = { ...(dc ?? blankHost(eng.id)), id: eng.id };
  const input: FillInput = {
    host: stand, engagement: eng, hosts, servicesByHost, tunnels,
    ...settingsFill(settings.data), cred: creds.cred,
  };
  // The Log section has no deep link to one entry yet: open the section.
  const openEntry = () => void navigate(sectionPath(id, "log"));

  /** One goal row. A pivot step belongs to its dual-homed host: filled against that host, state and writes keyed on it. */
  const row = (g: ChecklistGoal, owner?: Host) => {
    const ownerId = owner?.id ?? eng.id;
    const rowInput = owner ? { ...input, host: owner } : input;
    const { commands, hadAny } = goalCommands(g.id, rowInput, eng);
    const s = (owner ? byOwner.get(owner.id) ?? {} : state)[g.id];
    return (
      <GoalRow
        key={`${ownerId}:${g.id}`}
        goal={g}
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
        {...(owner ? { hostName: shortHostName(owner.name) } : {})}
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
      void qc.invalidateQueries({ queryKey: hostsKey(id) });
      void qc.invalidateQueries({ queryKey: ["progress"] });
    } catch (e) {
      setTick({ ticking: false, error: RavenError.from(e).message });
    }
  };

  return (
    <section aria-label="Engagement checklist" className="grid gap-6">
      <EngagementStuckCheck engagementId={id} />

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <Button disabled={tick.ticking} onClick={() => void runTick()}>Tick from log</Button>
        <div className="grid min-w-0 gap-1">
          <p role="status" className="m-0 text-meta text-fg-2">{tick.message}</p>
          {tick.error && <p role="alert" className="m-0 text-meta text-warn">{tick.error}</p>}
        </div>
      </div>

      <CredentialPicker credentials={creds.credentials} value={creds.cred} onChange={creds.pick} />

      <div className="grid gap-1">
        <h3 className={`m-0 ${labelClass}`}>Setup</h3>
        <ul className="m-0 list-none p-0">{grouped(setup)}</ul>
      </div>

      <AccessFlags engagementId={id} hosts={hosts} attempts={attempts} credentials={credentials} />

      <div className="grid gap-3">
        <h3 className={`m-0 ${labelClass}`}>Active Directory</h3>
        {AD_PLAYBOOKS.map((p) => (
          <PlaybookSection key={p.id} title={p.title} opensWhen={p.opensWhen} defaultOpen={opens[p.id]}>
            {p.goals.map((g) => row(g))}
          </PlaybookSection>
        ))}
      </div>

      <PlaybookSection
        title="Lateral movement"
        opensWhen="a host is dual-homed, or a credential hasn't been tried everywhere"
        defaultOpen={opens.lateral}
      >
        {dualHomed.map((h) => (
          <Fragment key={h.id}>
            <GroupHeading>Behind {h.name}</GroupHeading>
            {PIVOT_GOALS.map((g) => row(g, h))}
          </Fragment>
        ))}
        {grouped(LATERAL_MOVEMENT_GOALS)}
        <li className="pt-2 text-meta text-muted">
          Tunnels and hops are in <Link to={sectionPath(id, "network")} className="text-fg-2 underline underline-offset-2 hover:text-fg">Network</Link> (5).
        </li>
      </PlaybookSection>

      <CleanupPanel engagementId={id} hosts={hosts} entries={entries} domain={eng.domain} />
    </section>
  );
}
