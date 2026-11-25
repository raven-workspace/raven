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
} from "../../../engines/checklist/index";
import { playbookTriggers } from "../../../engines/credentials/state";
import type { Host } from "../../../types/host";
import { Button, labelClass, queryState } from "../../../ui/index";
import { CleanupPanel } from "../../cleanup/CleanupPanel/CleanupPanel";
import { EngagementStuckCheck } from "../../stuck/StuckView/StuckView";
import { useHosts } from "../../hosts/queries";
import { sectionPath } from "../../engagements/sections/sections";
import { useCredAttempts, useCredentials } from "../../credentials/queries";
import { useLog } from "../../log/queries";
import { AccessFlags } from "../AccessFlags/AccessFlags";
import { CredentialPicker } from "../CredentialPicker/CredentialPicker";
import { newCredLabels, useCredFill } from "../credPick";
import { useFilePickStore } from "../filePick";
import { usePortPickStore } from "../portPick";
import { goalCommands } from "../goalCommands";
import { shortHostName } from "../../../lib/hostName";
import { GoalRow } from "../GoalRow/GoalRow";
import { PlaybookSection } from "../PlaybookSection/PlaybookSection";
import { useChecklist, useChecklistMutations } from "../queries";
import { boardsSynced } from "../resync";
import { useHops, useTunnels } from "../../network/queries";
import { useEngagementServices } from "../../services/queries";
import { loadTickContext, tickFromLog } from "../ticks";
import { useSettings, settingsFill } from "../../settings/queries";
import { useEngagement } from "../../engagements/queries";
import { RavenError } from "../../../types/errors";
import { blankHost } from "../../hosts/blankHost";
import "./EngagementChecklist.scss";

/** Sub-heading above the first row of each group. */
const GroupHeading = ({ children }: { children: ReactNode }) => (
  <li role="presentation" className="engagement-checklist__group">
    <h4 className="engagement-checklist__group-title">{children}</h4>
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

  const facts = engagementFacts(eng, hosts);
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
      void boardsSynced(qc, id);
    } catch (e) {
      setTick({ ticking: false, error: RavenError.from(e).message });
    }
  };

  return (
    <section aria-label="Engagement checklist" className="engagement-checklist">
      <EngagementStuckCheck engagementId={id} />

      <div className="engagement-checklist__tick">
        <Button disabled={tick.ticking} onClick={() => void runTick()}>Tick from log</Button>
        <div className="engagement-checklist__tick-status">
          <p role="status" className="engagement-checklist__tick-message">{tick.message}</p>
          {tick.error && <p role="alert" className="engagement-checklist__error">{tick.error}</p>}
        </div>
      </div>

      <CredentialPicker credentials={creds.credentials} value={creds.cred} onChange={creds.pick} />

      <div className="engagement-checklist__setup">
        <h3 className={labelClass}>Setup</h3>
        <ul className="engagement-checklist__list">{grouped(setup)}</ul>
      </div>

      <AccessFlags engagementId={id} hosts={hosts} attempts={attempts} credentials={credentials} />

      <div className="engagement-checklist__playbooks">
        <h3 className={labelClass}>Active Directory</h3>
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
        <li className="engagement-checklist__network-note">
          Tunnels and hops are in <Link to={sectionPath(id, "network")} className="engagement-checklist__network-link">Network</Link> (5).
        </li>
      </PlaybookSection>

      <CleanupPanel engagementId={id} hosts={hosts} entries={entries} domain={eng.domain} />
    </section>
  );
}
