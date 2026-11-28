import { useNow } from "../../../lib/keys";
import type { Engagement } from "../../../types/engagement";
import { useCleanupCounts } from "../../cleanup/queries";
import { dateRange, EMPTY_PROGRESS, hasTimebox } from "../../engagements/format";
import { MsfLock } from "../../engagements/MsfLock/MsfLock";
import { useEngagement } from "../../engagements/queries";
import { Cell, useFitStrip } from "../../engagements/StatusStrip/StatusStrip";
import { useProgress } from "../../hosts/queries";
import { useThreadCounts } from "../../notes/useThreadCounts";
import { LhostCell } from "../LhostCell/LhostCell";
import { useListenerCount } from "../queries";
import { TimeboxCell } from "../TimeboxCell/TimeboxCell";
import "../../engagements/StatusStrip/StatusStrip.scss";
import "./StatusBar.scss";

/**
 * Drop steps (design §1.7, useFitStrip): when the bar runs out of room, Listeners goes first with the secondary parts,
 * then Cleanup, Threads and Metasploit, then the rest. LHOST and the timebox have no step: they never drop.
 */
export const DROP = { listeners: 1, cleanup: 2, threads: 3, msf: 4, flags: 5, rooted: 6 } as const;
const LAST_DROP = 6;

/** "0 listeners", "1 listener". Shown at zero until the terminal lands (RAV-78); then a zero hides it (design §1.5). */
const listenersText = (n: number) => `${n} ${n === 1 ? "listener" : "listeners"}`;

/**
 * The status bar at the foot of the frame (design §1.5): LHOST, Listeners, the engagement's cells (Rooted, Flags,
 * Metasploit, Threads, Cleanup), then the timebox at the right end. An engagement with no timebox shows its dates there.
 */
export function StatusBar({ engagementId }: { engagementId: string }) {
  const e = useEngagement(engagementId).data;
  return e ? <Bar engagement={e} /> : <div className="status-bar" />;
}

function Bar({ engagement: e }: { engagement: Engagement }) {
  const now = useNow();
  const progressQ = useProgress();
  // A failed or pending progress query must never read as "0/0": a dash while loading, "unavailable" (amber) on failure.
  const progress = progressQ.data ? (progressQ.data[e.id] ?? EMPTY_PROGRESS) : null;
  const failed = !progress && progressQ.isError;
  const dash = failed ? "unavailable" : "—";
  const tone = failed ? "warn" : undefined;
  const threads = useThreadCounts(e.id).total;
  const cleanup = useCleanupCounts().data?.[e.id] ?? 0;
  const listeners = useListenerCount(e.id);
  const { outer, inner } = useFitStrip(LAST_DROP);
  return (
    <div ref={outer} role="status" aria-label="Engagement status" className="status-bar">
      <div ref={inner} className="status-bar__cells">
        <LhostCell />
        <span data-drop={DROP.listeners}>{listenersText(listeners)}</span>
        <Cell label="Rooted" value={progress ? `${progress.hostsRooted}/${progress.hostsTotal}` : dash} step={DROP.rooted} tone={tone} />
        <Cell label="Flags" value={progress ? `${progress.flagsFound}/${progress.flagsTotal}` : dash} step={DROP.flags} tone={tone} />
        {e.kind === "exam-sim" && <MsfLock engagement={e} step={DROP.msf} />}
        {threads > 0 && <Cell label="Threads" value={String(threads)} step={DROP.threads} />}
        {cleanup > 0 && <Cell label="Cleanup" value={String(cleanup)} step={DROP.cleanup} />}
      </div>
      {hasTimebox(e) ? <TimeboxCell engagement={e} now={now} /> : <Cell label="Dates" value={dateRange(e.startsAt, e.endsAt, now)} />}
    </div>
  );
}
