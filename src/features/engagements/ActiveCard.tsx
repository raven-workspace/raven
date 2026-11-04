import { Link } from "react-router";
import { cx } from "../../lib/cx";
import type { Engagement } from "../../types/engagement";
import { Chip } from "../../ui";
import { useProgress } from "../hosts/queries";
import {
  EMPTY_PROGRESS,
  KIND_LABEL,
  dateRange,
  formatDuration,
  hasTimebox,
  progressLine,
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

export function ActiveCard({ engagement: e, now }: { engagement: Engagement; now: number }) {
  const scope = scopeSummary(e.scopeCidrs);
  const lastActivity = e.lastActivityAt;
  const progress = useProgress().data?.[e.id] ?? EMPTY_PROGRESS;

  return (
    <Link
      to={`/e/${e.id}`}
      className={cx(
        "group flex min-w-0 flex-col gap-2.5 rounded border border-line bg-bg px-4 pt-3.5 pb-3 no-underline",
        "cursor-default transition-colors duration-100 hover:border-line-strong hover:bg-surface",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="m-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{e.name}</h3>
        <div className="flex flex-wrap items-center gap-1">
          <Chip>{KIND_LABEL[e.kind]}</Chip>
          {e.subLabel && <Chip>{e.subLabel}</Chip>}
          {e.kind === "client" && e.client && <span className="ml-1 truncate text-xs text-muted-2">{e.client}</span>}
        </div>
      </div>

      {hasTimebox(e) ? (
        <TimeboxLine engagement={e} now={now} />
      ) : (
        <p className="m-0 flex min-w-0 items-baseline gap-1.5 text-xs text-muted-2">
          <span className="shrink-0">{dateRange(e.startsAt, e.endsAt, now)}</span>
          {scope && (
            <>
              <span className="text-faint">·</span>
              <span className="truncate font-mono text-[11.5px]">{scope}</span>
            </>
          )}
        </p>
      )}

      <p className="m-0 text-xs text-fg-2">{progressLine(progress)}</p>

      <p className="m-0 border-t border-line pt-2 text-xs text-muted">
        {lastActivity === null ? (
          "No activity yet"
        ) : (
          <>
            Last activity{" "}
            <span className="font-mono text-[11.5px] text-muted-2">{relativeTime(lastActivity, now)}</span>
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
    <div className="flex flex-col gap-1.5">
      <p className="m-0 flex items-baseline gap-1.5 text-xs text-muted-2">
        <span>Timebox {formatDuration(e.timeboxMinutes)}</span>
        <span className="text-faint">·</span>
        <span className={cx("font-mono text-[11.5px]", over ? "text-warn" : "text-fg")}>{left}</span>
      </p>
      <TimeBar fraction={timeboxElapsed(e.timeboxStart, e.timeboxMinutes, now)} over={over} />
    </div>
  );
}
