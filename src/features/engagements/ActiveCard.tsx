import { Link } from "react-router";
import { cx } from "../../lib/cx";
import type { Engagement } from "../../types/engagement";
import { Chip, ChipSet } from "../../ui";
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
} from "./format";

/** Hairline progress bar. Amber once the time is up; never the accent (time isn't a held fact). */
export function TimeBar({ fraction, over }: { fraction: number; over?: boolean }) {
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-line-2" aria-hidden>
      <div
        className={cx("h-full rounded-full", over ? "bg-warn" : "bg-fg-2")}
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

export function ActiveCard({ engagement: e, now }: { engagement: Engagement; now: number }) {
  const scope = scopeSummary(e.scopeCidrs);
  const lastActivity = e.lastActivityAt;
  const progress = useProgress().data?.[e.id] ?? EMPTY_PROGRESS;
  const threads = useThreadCounts(e.id).total;
  const cleanup = useCleanupCounts().data?.[e.id] ?? 0;

  return (
    <Link
      to={`/e/${e.id}`}
      className={cx(
        "group grid min-w-0 content-start gap-3 rounded border border-line bg-bg px-4 py-3 no-underline",
        "cursor-default transition-colors duration-100 hover:border-line-strong hover:bg-surface",
      )}
    >
      <div className="grid min-w-0 gap-2">
        <h3 className="m-0 truncate text-heading text-fg" title={e.name}>{e.name}</h3>
        <ChipSet className="items-center">
          <Chip>{KIND_LABEL[e.kind]}</Chip>
          {e.subLabel && <Chip>{e.subLabel}</Chip>}
          {e.kind === "client" && e.client && <span className="truncate text-meta text-muted-2">{e.client}</span>}
        </ChipSet>
      </div>

      {hasTimebox(e) ? (
        <TimeboxLine engagement={e} now={now} />
      ) : (
        <p className="m-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-4 text-meta text-muted-2">
          <span>{dateRange(e.startsAt, e.endsAt, now)}</span>
          {scope && <span className="truncate font-mono text-code" title={e.scopeCidrs.join(", ")}>{scope}</span>}
        </p>
      )}

      <p className="m-0 grid grid-flow-col justify-start gap-4 text-meta">
        <Stat label="Rooted" value={`${progress.hostsRooted}/${progress.hostsTotal}`} />
        <Stat label="Flags" value={`${progress.flagsFound}/${progress.flagsTotal}`} />
        {threads > 0 && <Stat label="Threads" value={String(threads)} />}
        {cleanup > 0 && <Stat label="Cleanup" value={String(cleanup)} />}
      </p>

      <p className="m-0 grid grid-flow-col justify-start gap-1 border-t border-line pt-2 text-meta text-muted">
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
  const left = timeLeft(e.timeboxStart, e.timeboxMinutes, now);
  const over = left === "Time's up";
  return (
    <div className="grid gap-2">
      <p className="m-0 grid grid-flow-col justify-start gap-4 text-meta">
        <Stat label="Timebox" value={formatDuration(e.timeboxMinutes)} />
        <span className={cx("font-mono text-code", over ? "text-warn" : "text-fg")}>{left}</span>
      </p>
      <TimeBar fraction={timeboxElapsed(e.timeboxStart, e.timeboxMinutes, now)} over={over} />
    </div>
  );
}
