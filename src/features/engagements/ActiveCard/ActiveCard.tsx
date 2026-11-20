import { Link } from "react-router";
import { cx } from "../../../lib/cx";
import type { Engagement } from "../../../types/engagement";
import { useCleanupCounts } from "../../cleanup/queries";
import { useThreadCounts } from "../../notes/useThreadCounts";
import { useProgress } from "../../hosts/queries";
import {
  EMPTY_PROGRESS,
  KIND_LABEL,
  dateRange,
  formatDuration,
  hasTimebox,
  relativeTime,
  scopeSummary,
  timeLeft,
  timeboxElapsed,
  timeboxNow,
  timeboxState,
  type TimeboxState,
} from "../format";
import "./ActiveCard.scss";

/** Text colour of a timebox's time left: accent while it runs, muted while paused, amber once the time is up. */
export const TIMEBOX_TEXT: Record<TimeboxState, string> = {
  "not-started": "timebox-text--not-started",
  running: "timebox-text--running",
  paused: "timebox-text--paused",
  over: "timebox-text--over",
};

/** Hairline progress bar of a timebox, coloured like its time left (owner call: the accent shows it running). */
export function TimeBar({ fraction, state }: { fraction: number; state: TimeboxState }) {
  return (
    <div className="time-bar" aria-hidden>
      <div
        className={`time-bar__fill time-bar__fill--${state}`}
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </div>
  );
}

/** One labelled number, like a status-strip cell: "Rooted 2/6". */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="active-card-stat">
      <span className="active-card-stat__label">{label}</span>
      <span className="active-card-stat__value">{value}</span>
    </span>
  );
}

/** Above this many hosts the pips stop reading at a glance; the counts carry it alone. */
const MAX_PIPS = 24;

/** One square per host, lit for each rooted one: rooted is held access, so it takes the accent. */
function HostPips({ rooted, total }: { rooted: number; total: number }) {
  if (total === 0 || total > MAX_PIPS) return null;
  return (
    <span aria-hidden className="host-pips">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx("host-pips__pip", i < rooted && "host-pips__pip--rooted")} />
      ))}
    </span>
  );
}

/**
 * An active engagement. Five rows, one per job, laid on the parent grid's subgrid so every card's rows line up:
 * name, what it is, when and where, progress, last activity.
 */
export function ActiveCard({ engagement: e, now }: { engagement: Engagement; now: number }) {
  const scope = scopeSummary(e.scopeCidrs);
  const lastActivity = e.lastActivityAt;
  const progress = useProgress().data?.[e.id] ?? EMPTY_PROGRESS;
  const threads = useThreadCounts(e.id).total;
  const cleanup = useCleanupCounts().data?.[e.id] ?? 0;
  const dated = e.startsAt !== null || e.endsAt !== null;
  // Kind first, then who it's for and the sub-label: plain metadata, as on the engagement's own header.
  const about = [e.kind === "client" ? e.client : null, e.subLabel].filter((v): v is string => !!v);

  return (
    <Link
      to={`/e/${e.id}`}
      className="active-card"
    >
      <h3 className="active-card__name" title={e.name}>{e.name}</h3>

      <p
        className={cx(
          "active-card__about",
          about.length === 1 && "active-card__about--1",
          about.length === 2 && "active-card__about--2",
        )}
      >
        <span>{KIND_LABEL[e.kind]}</span>
        {about.map((v, i) => (
          <span key={i} className={cx(i === about.length - 1 && "active-card__truncate")} title={v}>
            {v}
          </span>
        ))}
      </p>

      {hasTimebox(e) ? (
        <TimeboxLine engagement={e} now={now} />
      ) : dated || scope ? (
        <p className="active-card__when">
          {dated && <span>{dateRange(e.startsAt, e.endsAt, now)}</span>}
          {scope && <span className="active-card__scope" title={e.scopeCidrs.join(", ")}>{scope}</span>}
        </p>
      ) : (
        <span />
      )}

      <div className="active-card__progress">
        <HostPips rooted={progress.hostsRooted} total={progress.hostsTotal} />
        <p className="active-card__stats">
          {progress.hostsTotal === 0 ? (
            <span className="active-card__no-hosts">No hosts yet</span>
          ) : (
            <>
              <Stat label="Rooted" value={`${progress.hostsRooted}/${progress.hostsTotal}`} />
              <Stat label="Flags" value={`${progress.flagsFound}/${progress.flagsTotal}`} />
            </>
          )}
          {threads > 0 && <Stat label="Threads" value={String(threads)} />}
          {cleanup > 0 && <Stat label="Cleanup" value={String(cleanup)} />}
        </p>
      </div>

      <p className="active-card__last">
        {lastActivity === null ? (
          "No activity yet"
        ) : (
          <>
            <span>Last activity</span>
            <span className="active-card__ago">{relativeTime(lastActivity, now)}</span>
          </>
        )}
      </p>
    </Link>
  );
}

function TimeboxLine({ engagement: e, now }: { engagement: Engagement & { timeboxMinutes: number }; now: number }) {
  const clock = timeboxNow(e, now);
  const state = timeboxState(e, now);
  return (
    <div className="active-card__timebox">
      <p className="active-card__stats">
        <Stat label="Timebox" value={formatDuration(e.timeboxMinutes)} />
        <span className={cx("active-card__time-left", TIMEBOX_TEXT[state])}>{timeLeft(e.timeboxStart, e.timeboxMinutes, clock)}</span>
      </p>
      <TimeBar fraction={timeboxElapsed(e.timeboxStart, e.timeboxMinutes, clock)} state={state} />
    </div>
  );
}
