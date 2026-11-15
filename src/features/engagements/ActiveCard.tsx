import { Link } from "react-router";
import { cx } from "../../lib/cx";
import type { Engagement } from "../../types/engagement";
import { useCleanupCounts } from "../cleanup/queries";
import { useThreadCounts } from "../notes/useThreadCounts";
import { useProgress } from "../hosts/queries";
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
} from "./format";

/** Text colour of a timebox's time left: accent while it runs, muted while paused, amber once the time is up. */
export const TIMEBOX_TEXT: Record<TimeboxState, string> = {
  "not-started": "text-fg",
  running: "text-accent",
  paused: "text-muted",
  over: "text-warn",
};

/** Hairline progress bar of a timebox, coloured like its time left (owner call: the accent shows it running). */
export function TimeBar({ fraction, state }: { fraction: number; state: TimeboxState }) {
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-line-2" aria-hidden>
      <div
        className={cx(
          "h-full rounded-full",
          { "not-started": "bg-fg-2", running: "bg-accent", paused: "bg-muted", over: "bg-warn" }[state],
        )}
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </div>
  );
}

/** One labelled number, like a status-strip cell: "Rooted 2/6". */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="grid grid-flow-col items-baseline gap-1">
      <span className="text-muted-2">{label}</span>
      <span className="font-mono text-code text-fg tabular-nums">{value}</span>
    </span>
  );
}

/** Above this many hosts the pips stop reading at a glance; the counts carry it alone. */
const MAX_PIPS = 24;

/** One square per host, lit for each rooted one: rooted is held access, so it takes the accent. */
function HostPips({ rooted, total }: { rooted: number; total: number }) {
  if (total === 0 || total > MAX_PIPS) return null;
  return (
    <span aria-hidden className="grid auto-cols-[10px] grid-flow-col justify-start gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx("size-2.5", i < rooted ? "bg-accent" : "border border-line-strong")} />
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
      className={cx(
        "group row-span-5 grid min-w-0 grid-rows-subgrid rounded border border-line bg-bg px-4 py-3 no-underline",
        "cursor-default transition-colors duration-100 hover:border-line-strong hover:bg-surface",
      )}
    >
      <h3 className="m-0 truncate text-heading text-fg" title={e.name}>{e.name}</h3>

      <p
        className={cx(
          "m-0 grid min-w-0 items-baseline gap-4 text-meta text-muted-2",
          about.length === 0 && "grid-cols-[max-content]",
          about.length === 1 && "grid-cols-[max-content_minmax(0,1fr)]",
          about.length === 2 && "grid-cols-[max-content_max-content_minmax(0,1fr)]",
        )}
      >
        <span>{KIND_LABEL[e.kind]}</span>
        {about.map((v, i) => (
          <span key={i} className={cx(i === about.length - 1 && "truncate")} title={v}>
            {v}
          </span>
        ))}
      </p>

      {hasTimebox(e) ? (
        <TimeboxLine engagement={e} now={now} />
      ) : dated || scope ? (
        <p className="m-0 grid min-w-0 grid-flow-col auto-cols-max items-baseline justify-start gap-4 text-meta text-muted-2">
          {dated && <span>{dateRange(e.startsAt, e.endsAt, now)}</span>}
          {scope && <span className="truncate font-mono text-code" title={e.scopeCidrs.join(", ")}>{scope}</span>}
        </p>
      ) : (
        <span />
      )}

      <div className="grid content-start gap-2">
        <HostPips rooted={progress.hostsRooted} total={progress.hostsTotal} />
        <p className="m-0 grid grid-flow-col justify-start gap-4 text-meta">
          {progress.hostsTotal === 0 ? (
            <span className="text-muted">No hosts yet</span>
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

      <p className="m-0 grid grid-flow-col justify-start gap-1 self-end border-t border-line pt-2 text-meta text-muted">
        {lastActivity === null ? (
          "No activity yet"
        ) : (
          <>
            <span>Last activity</span>
            <span className="font-mono text-code text-muted-2">{relativeTime(lastActivity, now)}</span>
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
    <div className="grid gap-2">
      <p className="m-0 grid grid-flow-col justify-start gap-4 text-meta">
        <Stat label="Timebox" value={formatDuration(e.timeboxMinutes)} />
        <span className={cx("font-mono text-code", TIMEBOX_TEXT[state])}>{timeLeft(e.timeboxStart, e.timeboxMinutes, clock)}</span>
      </p>
      <TimeBar fraction={timeboxElapsed(e.timeboxStart, e.timeboxMinutes, clock)} state={state} />
    </div>
  );
}
